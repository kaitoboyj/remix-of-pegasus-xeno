// Static wallet pool + per-chain explorer helpers.
// Wallets are real on-chain addresses snapshotted via scripts/snapshot-wallets.mjs.
// This avoids any runtime fetching to the blockchain when users browse OTC orders.

import pool from '@/data/walletPool.json';

export type WalletChainKind = 'solana' | 'evm';

export const SOLANA_POOL: string[] = pool.solana;
export const EVM_POOL: string[] = pool.evm;

export function isEVMAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export function isSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

export function classifyAddress(addr: string): WalletChainKind | null {
  if (isEVMAddress(addr)) return 'evm';
  if (isSolanaAddress(addr)) return 'solana';
  return null;
}

// Map UI chain name (from useChainInfo / ChainContext) → explorer base URL for an address.
const EVM_EXPLORERS: Record<string, string> = {
  ethereum: 'https://etherscan.io/address/',
  eth: 'https://etherscan.io/address/',
  bsc: 'https://bscscan.com/address/',
  bnb: 'https://bscscan.com/address/',
  'bnb smart chain': 'https://bscscan.com/address/',
  polygon: 'https://polygonscan.com/address/',
  matic: 'https://polygonscan.com/address/',
  base: 'https://basescan.org/address/',
  arbitrum: 'https://arbiscan.io/address/',
  avalanche: 'https://snowtrace.io/address/',
};

/**
 * Build the explorer URL for a given wallet address.
 * - Solana → Solscan
 * - EVM → chain-specific explorer (defaults to Etherscan if chain unknown)
 */
export function explorerUrlFor(address: string, evmChainHint?: string): string | null {
  const kind = classifyAddress(address);
  if (kind === 'solana') return `https://solscan.io/account/${address}`;
  if (kind === 'evm') {
    const key = (evmChainHint || 'ethereum').toLowerCase();
    const base = EVM_EXPLORERS[key] || EVM_EXPLORERS.ethereum;
    return `${base}${address}`;
  }
  return null;
}

/**
 * Builds the visible wallet list for an OTC search. We always show 100 entries
 * (50 Solana + 50 EVM) so the UI feels populated and consistent.
 *
 * `tickIndex` drives one-by-one rotation: every tick we replace one slot with
 * a different address from the pool (cycling through). Pure deterministic —
 * no network calls, no loading state needed.
 */
export function buildVisibleWallets(tickIndex: number, perChain = 50): string[] {
  // Start with the first `perChain` of each pool, then rotate one slot per tick
  // by swapping in an address from later in the pool.
  const sol = rotatedSlice(SOLANA_POOL, perChain, tickIndex);
  const evm = rotatedSlice(EVM_POOL, perChain, tickIndex);
  return interleave(sol, evm);
}

function rotatedSlice(pool: string[], visible: number, tick: number): string[] {
  if (pool.length <= visible) return pool.slice();
  const out = pool.slice(0, visible);
  // Replace one slot per tick — slot index advances each tick, replacement
  // address also advances so we cycle through the entire pool.
  const slot = tick % visible;
  const replacementIdx = visible + (tick % (pool.length - visible));
  out[slot] = pool[replacementIdx];
  return out;
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}
