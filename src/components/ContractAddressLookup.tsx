import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Search, Copy, Check } from 'lucide-react';
import { getTokenMetadata, Token, isValidSolanaAddress } from '@/services/tokenMetadata';
import { motion, AnimatePresence } from 'framer-motion';

interface ContractAddressLookupProps {
  onTokenFound?: (token: Token) => void;
  className?: string;
}

export const ContractAddressLookup = ({ onTokenFound, className }: ContractAddressLookupProps) => {
  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<Token | null>(null);
  const [source, setSource] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const handleLookup = async () => {
    if (!address.trim()) {
      return;
    }

    if (!isValidSolanaAddress(address.trim())) {
      return;
    }

    setIsLoading(true);
    setToken(null);

    try {
      const result = await getTokenMetadata(address.trim());
      
      if (result.token) {
        setToken(result.token);
        setSource(result.source);
        onTokenFound?.(result.token);
      } else {
      }
    } catch (error) {
      console.error('Lookup error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLookup();
    }
  };

  const copyAddress = async () => {
    if (token?.address) {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatPrice = (price?: number) => {
    if (!price) return 'N/A';
    if (price < 0.000001) return `$${price.toExponential(4)}`;
    if (price < 1) return `$${price.toFixed(6)}`;
    return `$${price.toFixed(2)}`;
  };

  const formatPriceChange = (change?: number) => {
    if (change === undefined) return null;
    const isPositive = change >= 0;
    return (
      <span className={isPositive ? 'text-green-500' : 'text-red-500'}>
        {isPositive ? '+' : ''}{change.toFixed(2)}%
      </span>
    );
  };

  return (
    <div className={className}>
      <div className="flex gap-2">
        <Input
          placeholder="Enter token contract address..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
          disabled={isLoading}
        />
        <Button onClick={handleLookup} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </div>

      <AnimatePresence>
        {token && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4"
          >
            <Card className="bg-card/90 border border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Token Logo */}
                  <div className="flex-shrink-0">
                    {token.logoURI ? (
                      <img
                        src={token.logoURI}
                        alt={token.symbol}
                        className="w-12 h-12 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                        {token.symbol.slice(0, 2)}
                      </div>
                    )}
                  </div>

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-lg text-foreground">{token.name}</h3>
                      <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {token.symbol}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                        {token.address.slice(0, 8)}...{token.address.slice(-8)}
                      </span>
                      <button
                        onClick={copyAddress}
                        className="text-muted-foreground hover:text-primary transition-colors"
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                      <div>
                        <span className="text-xs text-muted-foreground">Price</span>
                        <p className="text-sm font-medium text-foreground">
                          {formatPrice(token.price)}
                          {token.priceChange24h !== undefined && (
                            <span className="ml-1 text-xs">
                              {formatPriceChange(token.priceChange24h)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Decimals</span>
                        <p className="text-sm font-medium text-foreground">{token.decimals}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Source</span>
                        <p className="text-sm font-medium text-foreground capitalize">{source}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
