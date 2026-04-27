import { useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { Loader2, Check, AlertCircle, Rocket, ShieldCheck, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { buildVisibleWallets, explorerUrlFor } from '@/services/walletPool';
import { shortAddress } from '@/services/tokenHolders';

interface ListingDraft {
  contract: string;
  name: string;
  symbol: string;
  website: string;
  twitter: string;
  telegram: string;
  description: string;
}

const EMPTY_DRAFT: ListingDraft = {
  contract: '',
  name: '',
  symbol: '',
  website: '',
  twitter: '',
  telegram: '',
  description: '',
};

type VerifyState = 'idle' | 'checking' | 'qualified' | 'failed';

const ListPage = () => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListingDraft>(EMPTY_DRAFT);
  const [verify, setVerify] = useState<VerifyState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Reuse the wallet pool so the "recently listed" grid mirrors OTC's flow.
  const visibleWallets = buildVisibleWallets(0).slice(0, 8);

  const update = (k: keyof ListingDraft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const resetAndClose = () => {
    setOpen(false);
    setVerify('idle');
    setError(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleVerify = async () => {
    setError(null);
    if (!draft.contract.trim() || !draft.name.trim() || !draft.symbol.trim()) {
      setError('Contract address, token name and symbol are required.');
      return;
    }
    setVerify('checking');
    // Simulated qualification check (matches OTC verification UX).
    await new Promise((r) => setTimeout(r, 1800));
    setVerify('qualified');
  };

  const handleSubmit = () => {
    toast.success('Listing submitted for review', {
      description: `${draft.name} (${draft.symbol.toUpperCase()}) is queued for the Pegswap dashboard.`,
    });
    resetAndClose();
  };

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

      <div className="container mx-auto px-4 pt-32">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="glass-card border-primary/20">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-2xl">Token Listings</CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="w-3 h-3" /> Verified projects
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Browse tokens listed on the Pegswap dashboard. Want yours here? Click{' '}
                <span className="text-primary font-semibold">Get Listed</span> at the top.
              </p>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {visibleWallets.map((w) => (
                  <a
                    key={w.address}
                    href={explorerUrlFor(w.address, w.chain)}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-card p-3 rounded-lg hover:border-primary/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground uppercase">{w.chain}</p>
                      <p className="text-sm font-mono truncate">{shortAddress(w.address)}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Listing dialog */}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : resetAndClose())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-primary" />
              Apply for Pegswap Listing
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Verification wallet needs to hold at least <b>1,000,000 token supply</b>{' '}
                <b>OR $5,000</b> worth of holdings to qualify for listing.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Input
                placeholder="Token contract address"
                value={draft.contract}
                onChange={(e) => update('contract', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Token name"
                  value={draft.name}
                  onChange={(e) => update('name', e.target.value)}
                />
                <Input
                  placeholder="Symbol"
                  value={draft.symbol}
                  onChange={(e) => update('symbol', e.target.value)}
                />
              </div>
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
                placeholder="Short description"
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                maxLength={160}
              />
            </div>

            {error && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {error}
              </p>
            )}

            {verify === 'qualified' && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
                <Check className="w-4 h-4" /> Wallet qualifies for listing.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={resetAndClose}>
                Cancel
              </Button>
              {verify !== 'qualified' ? (
                <Button onClick={handleVerify} disabled={verify === 'checking'}>
                  {verify === 'checking' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying wallet…
                    </>
                  ) : (
                    'Verify wallet balance'
                  )}
                </Button>
              ) : (
                <Button onClick={handleSubmit}>Submit listing</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ListPage;
