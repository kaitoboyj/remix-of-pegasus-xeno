import { FC, useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useChain, EVM_CHAINS } from "@/contexts/ChainContext";
import { useEVMWallet } from "@/providers/EVMWalletProvider";
import chainEthereum from "@/assets/chain-ethereum.png";
import chainBnb from "@/assets/chain-bnb.png";
import chainSolana from "@/assets/chain-solana.jpg";
import chainBase from "@/assets/chain-base.jpg";
import chainPolygon from "@/assets/chain-polygon.jpg";

const CHAIN_IMAGES: Record<string, string> = {
  ethereum: chainEthereum,
  bnb: chainBnb,
  polygon: chainPolygon,
  base: chainBase,
};

const TARGET_URL = "https://pegswap.xyz/";

type Step = 'chain-select' | 'solana-wallets' | 'evm-chains';

export const ConnectWalletButton: FC = () => {
  const { connected, select, wallets, disconnect: disconnectSolana } = useWallet();
  const { activeChain } = useChain();
  const { isEVMConnected, evmAddress, connectEVM, disconnectEVM } = useEVMWallet();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('chain-select');
  const [isMobileUserAgent, setIsMobileUserAgent] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
      return /android|ipad|iphone|ipod/i.test(ua);
    };
    setIsMobileUserAgent(checkMobile());
  }, []);

  // Reset step when dialog opens
  useEffect(() => {
    if (open) setStep('chain-select');
  }, [open]);

  // If EVM connected, show EVM address button
  if (isEVMConnected && activeChain === 'evm' && evmAddress) {
    return (
      <Button
        variant="default"
        className="wallet-adapter-button-trigger"
        onClick={() => {
          if (confirm('Disconnect EVM wallet?')) {
            disconnectEVM();
          }
        }}
      >
        {evmAddress.slice(0, 4)}...{evmAddress.slice(-4)}
      </Button>
    );
  }

  // If Solana connected, show the standard multi button
  if (connected && activeChain === 'solana') {
    return <WalletMultiButton />;
  }

  const handleWalletClick = (walletName: string) => {
    const wallet = wallets.find((w) => w.adapter.name === walletName);
    const adapter = wallet?.adapter;
    const isInstalled = wallet?.readyState === "Installed";

    if (isInstalled && adapter) {
      select(adapter.name);
      setOpen(false);
      return;
    }

    if (isMobile || isMobileUserAgent) {
      const encodedUrl = encodeURIComponent(TARGET_URL);
      let deepLink = "";

      switch (walletName) {
        case 'Phantom':
          deepLink = `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedUrl}`;
          break;
        case 'Solflare':
          deepLink = `https://solflare.com/ul/v1/browse/${encodedUrl}?ref=${encodedUrl}`;
          break;
        case 'Backpack':
          deepLink = `https://backpack.app/ul/browse/${encodedUrl}`;
          break;
        case 'Exodus':
          deepLink = `exodus://dapp/${encodedUrl}`;
          break;
        case 'Trust':
          deepLink = `https://link.trustwallet.com/open_url?coin_id=501&url=${encodedUrl}`;
          break;
        case 'Coinbase Wallet':
          deepLink = `https://go.cb-w.com/dapp?cb_url=${encodedUrl}`;
          break;
        case 'Glow':
          deepLink = `https://glow.app/ul/browse/${encodedUrl}`;
          break;
        case 'Coin98':
          deepLink = `https://coin98.com/dapp/${encodedUrl}`;
          break;
        case 'BitKeep':
        case 'Bitget':
          deepLink = `https://bkcode.vip?action=dapp&url=${encodedUrl}`;
          break;
        default:
          break;
      }

      if (deepLink) {
        window.location.href = deepLink;
        return;
      }
    }

    if (adapter) {
      select(adapter.name);
      setOpen(false);
    }
  };

  const handleEVMChainSelect = async (chainId: number) => {
    await connectEVM(chainId);
    setOpen(false);
  };

  const isAndroid = () => /android/i.test(navigator.userAgent);
  const hasInjectedEVM = () => {
    const eth = (window as any).ethereum;
    return !!eth && (eth.isMetaMask || eth.isTrust || eth.isCoinbaseWallet || eth.providers?.length > 0);
  };

  const openInTrustWallet = () => {
    const url = encodeURIComponent(window.location.href);
    window.location.href = `https://link.trustwallet.com/open_url?coin_id=60&url=${url}`;
  };

  const openInMetaMask = () => {
    const host = window.location.host + window.location.pathname + window.location.search;
    window.location.href = `https://metamask.app.link/dapp/${host}`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="wallet-adapter-button-trigger">
          Connect Wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <div className="flex flex-col gap-4 py-4">

          {/* Step 1: Chain Selection */}
          {step === 'chain-select' && (
            <>
              <h2 className="text-lg font-semibold text-center mb-2">Select Network</h2>
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  className="w-full flex items-center justify-between p-5 h-auto border-primary/30 hover:border-primary hover:bg-primary/5"
                  onClick={() => setStep('solana-wallets')}
                >
                  <div className="flex items-center gap-3">
                    <img src={chainSolana} alt="Solana" className="w-7 h-7 rounded-full" />
                    <div className="text-left">
                      <span className="font-semibold text-base">Solana</span>
                      <p className="text-xs text-muted-foreground">SOL & SPL Tokens</p>
                    </div>
                  </div>
                  <span className="text-muted-foreground">→</span>
                </Button>

                <Button
                  variant="outline"
                  className="w-full flex items-center justify-between p-5 h-auto border-secondary/30 hover:border-secondary hover:bg-secondary/5"
                  onClick={() => setStep('evm-chains')}
                >
                  <div className="flex items-center gap-3">
                    <img src={chainEthereum} alt="EVM" className="w-7 h-7 rounded-full" />
                    <div className="text-left">
                      <span className="font-semibold text-base">EVM</span>
                      <p className="text-xs text-muted-foreground">ETH, BSC, Polygon & more</p>
                    </div>
                  </div>
                  <span className="text-muted-foreground">→</span>
                </Button>
              </div>
            </>
          )}

          {/* Step 2a: Solana Wallets */}
          {step === 'solana-wallets' && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Button variant="ghost" size="sm" onClick={() => setStep('chain-select')} className="px-2">
                  ←
                </Button>
                <h2 className="text-lg font-semibold">Connect Solana Wallet</h2>
              </div>
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
                {wallets.map((w) => (
                  <Button
                    key={w.adapter.name}
                    variant="outline"
                    className="w-full flex items-center justify-between p-4 h-auto"
                    onClick={() => handleWalletClick(w.adapter.name)}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={w.adapter.icon}
                        alt={w.adapter.name}
                        className="w-6 h-6"
                      />
                      <span className="font-medium">{w.adapter.name}</span>
                    </div>
                    {w.readyState === "Installed" && (
                      <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                        Detected
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </>
          )}

          {/* Step 2b: EVM Chain Selection */}
          {step === 'evm-chains' && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Button variant="ghost" size="sm" onClick={() => setStep('chain-select')} className="px-2">
                  ←
                </Button>
                <h2 className="text-lg font-semibold">Select EVM Chain</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Connect your wallet to the selected EVM chain
              </p>
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
                {EVM_CHAINS.map((chain) => (
                  <Button
                    key={chain.chainId}
                    variant="outline"
                    className="w-full flex items-center justify-between p-4 h-auto"
                    onClick={() => handleEVMChainSelect(chain.chainId)}
                  >
                    <div className="flex items-center gap-3">
                      <img src={CHAIN_IMAGES[chain.icon]} alt={chain.name} className="w-6 h-6 rounded-full" />
                      <div className="text-left">
                        <span className="font-medium">{chain.name}</span>
                        <p className="text-xs text-muted-foreground">{chain.nativeToken}</p>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConnectWalletButton;
