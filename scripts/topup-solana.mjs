// Top up Solana wallets to 50 by adding WSOL holders, merging into existing JSON.
import fs from 'node:fs';

const QUICKNODE_RPC = 'https://blissful-young-water.solana-mainnet.quiknode.pro/7780643ea7554accdcd50e291d0964975aa8f33a';

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

function decodeOwner(b64) {
  if (!b64) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 64) return null;
  const ownerBytes = bytes.slice(32, 64);
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + ownerBytes.toString('hex'));
  let out = '';
  while (n > 0n) { out = ALPHA[Number(n % 58n)] + out; n = n / 58n; }
  for (const b of ownerBytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

const pool = JSON.parse(fs.readFileSync('src/data/walletPool.json', 'utf8'));
console.log(`Current Solana: ${pool.solana.length}`);

const largest = await rpc(QUICKNODE_RPC, 'getTokenLargestAccounts', ['So11111111111111111111111111111111111111112']);
const accounts = (largest?.value || []).slice(0, 60).map(a => a.address);
console.log(`Got ${accounts.length} WSOL accounts`);

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

const merged = [...new Set([...pool.solana, ...owners])].slice(0, 50);
pool.solana = merged;
pool.snapshotAt = new Date().toISOString();
fs.writeFileSync('src/data/walletPool.json', JSON.stringify(pool, null, 2));
console.log(`✓ Solana now has ${merged.length} addresses`);
