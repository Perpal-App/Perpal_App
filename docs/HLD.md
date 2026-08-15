# PerPal high-level design

Status: Pacifica mainnet integration implemented locally on 8 August 2026. Static validation does not replace a small-value physical Android test.

## Product flow

1. Sign in with Privy. Privy provisions or restores public Solana wallet **M**.
2. Activate private trading once. The app derives or restores device-held Ed25519 wallet **T** and keeps its signing seed in secure storage.
3. Fund T through Umbra: M deposits USDC or USDT and a user-chosen SOL reserve; Umbra relays the claim into T.
4. Browse Pacifica markets without a wallet signature. REST supplies the catalog and initial snapshot; WebSocket supplies live prices.
5. Review a trade. If Pacifica collateral is short, the app converts only the required USDT to USDC in T, then deposits at least Pacifica's 10 USDC minimum from T.
6. The app calculates the exact base-asset size, fee estimate, leverage, mark, and slippage boundary. A fresh mark is checked immediately before T signs Pacifica's canonical request.
7. Closing a position is a reduce-only market order. Pacifica collateral stays in the account until the user requests withdrawal.
8. **Withdraw privately** requests an idempotent Pacifica USDC withdrawal to T, waits for T's balance, then sends it through Umbra to M or another Solana wallet.
9. Rotate T only after Solana balances, Pacifica balance/pending balance, positions, orders, and private operations all verify empty.

The Portfolio presents T wallet value plus Pacifica account equity as one product-level **Private funds** balance. Venue ledger fields remain internal except when a trade, risk state, or withdrawal confirmation needs them. Closing a position increases this aggregate balance; a user-requested private withdrawal performs Pacifica → T → Umbra without exposing those intermediate steps as separate wallets.

Pacifica's account is a venue ledger keyed by T, not another user-facing wallet. The UI exposes only Wallet, Markets, Order, and Portfolio.

## Runtime boundaries

- `src/config/`: validates mobile build configuration and refuses an incomplete mainnet build.
- `src/wallet/trading/`: derives, restores, signs with, and safely rotates T.
- `src/integrations/umbra/`: resumable M-to-T funding and T-to-destination private withdrawal.
- `src/integrations/perps/pacifica/`: public market/candle/account reads, canonical signed actions, Solana USDC deposit, order validation, and resumable withdrawal.
- `src/integrations/solana/`: signed RPC, stablecoin conversion, transaction verification, submission, and confirmation.
- `workers/gateway/`: authenticated Solana RPC and verified Jupiter build gateway. Pacifica public and signed APIs are called directly because authentication is T's request signature, never a server credential.

Screens render state and collect intent. They do not construct Pacifica signatures, Solana deposit instructions, Umbra proofs, or transaction bytes.

## Pacifica market data

- `GET /api/v1/info` is authoritative for symbol, tick/lot size, order limits, isolated-only state, and maximum leverage.
- `GET /api/v1/info/prices` supplies mark, oracle, funding, next funding, volume, open interest, prior price, and timestamp.
- `wss://.../ws`, subscription source `prices`, updates the REST snapshot. Older timestamps cannot overwrite a newer snapshot. Reconnect performs a fresh REST reconciliation.
- `GET /api/v1/kline/mark` supplies chart candles so analysis and executable risk use the same venue mark family.
- Missing or stale required data is unavailable, never replaced by an estimate. Trading is blocked until the mark is current.

## Market intelligence and notifications

- The public Worker route `GET /v1/market-briefing` normalizes configured CoinDesk, MarketWatch, and Federal Reserve RSS feeds plus FXMacroData's official U.S. economic calendar. These public sources require no Worker secret.
- News is source-attributed and time-stamped. Perps, U.S. crypto-policy, and Fed labels are derived only from words present in the returned articles.
- The event timeline includes only upcoming high-impact United States releases from the API's UTC calendar, including Fed events when the provider schedules them. It does not scrape or invent dates.
- The Home screen refreshes the briefing while focused and keeps the prior successful snapshot during a transient failure. The Worker cache bounds upstream traffic.
- A bounded, non-sensitive MMKV activity stream records private-wallet activation/rotation, funding, collateral deposit, order, cancellation, and private-withdrawal outcomes. It never stores addresses, transaction identifiers, signatures, amounts, or proofs. Current Pacifica gainers/losers and the latest relevant news are rendered live rather than persisted as repeated notifications.

## Signing and orders

T signs Pacifica's documented recursively sorted compact JSON with Ed25519. The app verifies the returned signature locally before submission. The signed header binds operation type, timestamp, and a five-second expiry window.

The MVP order surface implements open and full reduce-only close with market orders. Before confirmation it shows side, exact base size, mark, notional, leverage, estimated taker fee, and 0.5% slippage. Immediately before submission it refetches the market mark and rejects a stale or out-of-bound plan. Opening updates the chosen leverage and then submits the order; both requests are signed by T under the single confirmed intent. Open orders are readable and cancellable from Portfolio with a separate confirmation.

Limit, standalone stop, and edit-order UI are deliberately not claimed as complete. Pacifica documents those endpoints, but adding controls without an end-to-end confirmation and recovery design would create a false feature.

## Collateral and settlement

Pacifica standard deposits accept mainnet USDC only. USDT may be held privately in T but converts through the existing verified Jupiter route before a Pacifica deposit. The deposit instruction uses configured Pacifica program, central state, vault, and USDC mint addresses. It is simulated and its network fee, T balance, mint, authority, accounts, amount, and unsigned message are verified before T signs.

Pacifica withdrawal requests use a persisted UUID idempotency key. A retry reuses the same request and never creates a second withdrawal. The configured public withdrawal fee is displayed before confirmation. Once USDC reaches T, the existing Umbra private-exit state machine takes over.

## Privacy and custody boundary

- PerPal never holds M or T signing keys and never takes custody of funds.
- Umbra can obscure the direct M-to-T funding link only within its prover, indexer, relayer, and anonymity-set assumptions.
- T's Solana deposit and withdrawal activity is public and linkable to T.
- Pacifica can observe T's account, orders, positions, timing, and withdrawals. Pacifica uses off-chain matching and its documented hot/cold bridge custody model; venue collateral is not self-custodied by PerPal.
- The assistant can prepare an order but cannot confirm, sign, or submit it.

## Decision record: Pacifica replaces Flash

Flash Trade was removed because it is shutting down. Velocity was not restored because its current audit and hosted data surface were not strong enough for the MVP. Hyperliquid was rejected because it does not preserve the required Solana stablecoin deposit path. Pacifica was selected because it exposes a current Solana USDC deposit path, public market/account APIs, and locally signed Ed25519 trading actions compatible with T.

All Flash integration modules, the Flash SDK dependency, ER configuration, internal fee signer, settlement provider, screens, hooks, and Worker provider flag were removed. A narrow storage parser still recognizes the old provider label only to avoid destroying a user's already persisted Umbra recovery record; it immediately normalizes that record to Pacifica and executes no legacy provider code.

## Release confirmation still required

Before calling the Pacifica migration device-confirmed, use a release-like build on a physical Android device with small mainnet amounts:

1. Restore Privy M and T after a cold app start.
2. Load REST markets, WebSocket price updates, and mark candles.
3. Fund T through Umbra and resume after an interruption.
4. Convert a small USDT shortfall if selected, deposit USDC to Pacifica, and verify account state.
5. Open and close the minimum position, verify rejection of an expired preview, and cancel an open order.
6. Withdraw Pacifica USDC to T, then privately to M and an external wallet; interrupt and resume each phase.
7. Verify T rotation rejects every non-zero balance, order, position, and pending operation.
8. Measure intent-to-submission and submission-to-Pacifica acknowledgement separately.
