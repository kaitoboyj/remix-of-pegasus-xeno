// One-time snapshot of real wallet pools. Run with: node scripts/snapshot-wallets.mjs
// Output: src/data/walletPool.json

import fs from 'node:fs';
import path from 'node:path';

const SOLANA_TOKEN = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const QUICKNODE_RPC = 'https://blissful-young-water.solana-mainnet.quiknode.pro/7780643ea7554accdcd50e291d0964975aa8f33a';
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_EVM = '0x0000000000000000000000000000000000000000';

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`${method}: ${d.error.message}`);
  return d.result;
}

// Decode SPL token account owner from base64 account data (offset 32, 32 bytes)
function decodeOwner(b64) {
  if (!b64) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 64) return null;
  const ownerBytes = bytes.slice(32, 64);
  // base58 encode
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + ownerBytes.toString('hex'));
  let out = '';
  while (n > 0n) { out = ALPHA[Number(n % 58n)] + out; n = n / 58n; }
  for (const b of ownerBytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

async function fetchSolanaOwnersFor(token) {
  const largest = await rpc(QUICKNODE_RPC, 'getTokenLargestAccounts', [token]);
  const accounts = (largest?.value || []).slice(0, 60).map(a => a.address);
  const owners = [];
  for (let i = 0; i < accounts.length; i += 5) {
    const chunk = accounts.slice(i, i + 5);
    try {
      const res = await rpc(QUICKNODE_RPC, 'getMultipleAccounts', [chunk, { encoding: 'base64' }]);
      for (const v of (res?.value || [])) {
        const owner = decodeOwner(v?.data?.[0]);
        if (owner && owner.length >= 32 && owner.length <= 44) owners.push(owner);
      }
    } catch (e) { console.warn('chunk failed', e.message); }
  }
  return owners;
}

async function snapshotSolana() {
  console.log('Fetching Solana largest token accounts...');
  const primary = await fetchSolanaOwnersFor(SOLANA_TOKEN);
  console.log(`Primary token: ${primary.length} owners.`);
  let combined = [...primary];
  if (combined.length < 50) {
    console.log('Topping up from WSOL holders...');
    const wsol = await fetchSolanaOwnersFor('So11111111111111111111111111111111111111112');
    combined = combined.concat(wsol);
  }
  const uniq = [...new Set(combined)].slice(0, 50);
  console.log(`Resolved ${uniq.length} unique owners.`);
  return uniq;
}

function topicToAddress(topic) {
  if (!topic || typeof topic !== 'string') return null;
  return '0x' + topic.slice(-40).toLowerCase();
}

async function snapshotEVM() {
  console.log('Fetching USDC transfers on Ethereum...');
  const latestHex = await rpc(ETH_RPC, 'eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const seen = new Set();
  const out = [];
  // 4 windows of 5000 blocks each
  for (let i = 0; i < 8 && out.length < 50; i++) {
    const end = latest - i * 5000;
    const start = Math.max(0, end - 4999);
    try {
      const logs = await rpc(ETH_RPC, 'eth_getLogs', [{
        address: USDC_ETH,
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
        topics: [TRANSFER_TOPIC],
      }]);
      for (const log of logs) {
        for (const t of [log.topics?.[1], log.topics?.[2]]) {
          const a = topicToAddress(t);
          if (a && a !== ZERO_EVM && !seen.has(a)) { seen.add(a); out.push(a); if (out.length >= 50) break; }
        }
        if (out.length >= 50) break;
      }
      console.log(`Window ${i}: total=${out.length}`);
    } catch (e) {
      console.warn(`Window ${i} failed:`, e.message);
    }
  }
  return out.slice(0, 50);
}

const [solana, evm] = await Promise.all([snapshotSolana(), snapshotEVM()]);
const outPath = path.resolve('src/data/walletPool.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ solana, evm, snapshotAt: new Date().toISOString() }, null, 2));
console.log(`\n✓ Wrote ${solana.length} Solana + ${evm.length} EVM addresses to ${outPath}`);
