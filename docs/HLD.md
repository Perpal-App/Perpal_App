# Perpal Android MVP HLD

## Product flow

1. Privy creates or restores public wallet **M** after sign-in.
2. The user activates private trading once. A fixed M signature deterministically creates or recovers private wallet **T**; later sessions restore T without an unlock step.
3. Public Flash Trade v2 market groups and venue state load without a wallet signature. The catalog comes from the installed Flash SDK and exposes every active mainnet market that has both long and short configurations.
4. Funding is resumable: the user selects USDC or USDT plus a user-funded SOL reserve, M deposits through Umbra, and Umbra's relayer claims into T.
5. A trade allocates only the required collateral from T. Flash settles in USDC, so an exact USDT shortfall converts through a verified Jupiter plan before Flash setup/deposit. The final Flash quote is decoded, simulated, displayed, and explicitly confirmed before T signs.
6. Closing a position creates an independent settlement record keyed by Flash pool, market, and side. Proceeds are collected into T without a separate user action.
7. **Withdraw privately** first collects safe Flash collateral into T, then sends it through Umbra to M or another Solana wallet.
8. T rotation is allowed only after T, Flash's internal fee signer, Flash positions/orders/collateral, and every resumable operation verify empty.

Flash basket and ledger accounts are protocol implementation details, not user wallets or onboarding steps. The UI exposes Markets, Portfolio, and Wallet only.

## Runtime boundaries

- `src/features/`: screens, confirmations, and progress.
- `src/integrations/privy/`: M provisioning and Privy signing.
- `src/wallet/trading/`: T derivation, local signing, restore, and rotation.
- `src/integrations/umbra/`: resumable M-to-T funding and T-to-destination private exit.
- `src/integrations/perps/flash/`: Flash catalog, ER state, orders, portfolio, funding, and settlement.
- `workers/gateway/`: authenticated bounded Solana RPC, stablecoin swap-build proxy, and public market-data routes.

The deployed Worker exposes HTTP JSON-RPC, not Solana WebSocket subscriptions. Umbra MPC completion uses the SDK's polling monitor through the authenticated RPC adapter.

## Market data and execution

- The installed Flash SDK is the routing catalog. Markets are grouped by active mainnet pool; incomplete one-sided entries are not advertised as tradeable.
- Flash ER account snapshots supply live venue availability and open interest. Requests are bounded to 24 accounts and batched per selected market group.
- Pyth Hermes currently supplies streaming reference prices for BTC, ETH, and SOL. Other Flash markets display provider state and receive an authoritative price in the required Flash order review.
- A stale or missing reference never silently replaces the Flash quote. The quote is bound to pool, market, side, size, collateral, leverage, fees, expiry, and signer.

## Position isolation

Flash settlement records are independent per pool, market, and side. Recovery processes records independently, so a slow close or withdrawal does not block another open position.

## Fees

Perpal has no paymaster and sponsors no transaction fee.

- M pays Umbra deposit transactions.
- Umbra's relayer pays claim transaction fees and deducts its declared fee from the note.
- T receives the user-selected SOL reserve and pays conversion, Flash setup, collateral allocation, and trade transactions.
- Flash withdrawal actions use a deterministic internal signer **S**. T funds S on demand from the user's reserve; there is no fixed 0.05 SOL cap.

Without a sponsor, the final SOL in T cannot privately deposit itself while also paying that deposit fee. The MVP retains unused SOL as the user's reusable fee reserve and blocks rotation until T and S are empty.

## Privacy boundary

Umbra breaks the direct public M-to-T transfer link under Umbra's prover, indexer, relayer, and anonymity-set assumptions. T's later Solana and Flash activity is public and linkable to T. Flash's signer S is linkable to T but not directly to M. Positions, orders, and timing are not hidden from Flash.

## Decision record: sole Flash provider

On 2026-08-07 the product scope changed from selectable Flash/Velocity venues to Flash Trade v2 only. Velocity added duplicate account, collateral, portfolio, recovery, UI, configuration, and dependency paths without improving the intended private-wallet UX. The Velocity adapter and dependency were removed. USDC and USDT remain user-selectable funding assets; only the required USDT amount converts to Flash's USDC collateral inside T.

## Release gate

TypeScript success proves static integration only. MVP completion requires a release-like physical Android run with small mainnet amounts covering Privy activation, Umbra funding, Flash setup/open/close, automatic settlement, private withdrawal, interruption recovery, and rotation rejection/success. Intent-to-submission and ER acknowledgement must be measured separately.
