# PerPal high-level design

Status: Pacifica mainnet lifecycle and the first Velocity mainnet order path are implemented locally. Velocity close, withdrawal, rotation checks, and physical-device execution remain unverified and must not be described as complete.

## Product flow

1. Sign in with Privy. Privy provisions or restores public Solana wallet **M**.
2. The app automatically restores T or performs its one-time deterministic derivation after M connects. Normal screens show a skeleton while this completes; there is no separate activation step. The device-held Ed25519 signing seed stays in secure storage.
3. Fund T through Umbra: M deposits USDC or USDT plus a user-chosen SOL fee reserve. Umbra uses the native SOL mint internally, wraps SOL during deposit, and closes its callback helper account to deliver spendable native SOL to T. The relayer pays the claim transaction fee.
4. Browse markets without a wallet signature and select Pacifica or Velocity from the Markets header.
5. Review a trade. Pacifica uses USDC and observes its separate 10 USDC minimum credited deposit. Velocity uses USDT; when T lacks enough USDT, the app prepares a separately reviewed Jupiter USDC-to-USDT swap from T. Umbra funding remains provider-neutral and lands in T without a provider choice.
6. The app calculates the exact base-asset size, fee estimate, leverage, mark, and slippage boundary. A fresh mark is checked immediately before T signs Pacifica's canonical request.
7. Pacifica closes with a reduce-only market order. Velocity close and provider withdrawal remain an explicit pending implementation and device-verification item.
8. **Withdraw privately** requests an idempotent Pacifica USDC withdrawal to T, waits for T's balance, then sends it through Umbra to M or another Solana wallet.
9. Rotate T only after Pacifica state, Velocity positions/collateral, pending trade/funding/withdrawal work, and token balances verify empty. Velocity is not yet wired into this rotation guard, so rotation must stay blocked when Velocity has been used.

The Portfolio presents T wallet value plus provider equity as one product-level **Private funds** balance. Venue ledger fields remain internal except when a trade, risk state, or withdrawal confirmation needs them. Its Swap sheet lets the user explicitly review and sign USDC↔USDT swaps within T. Velocity equity is not included until its portfolio lifecycle is implemented.

Provider accounts are ledgers keyed by T, not additional user-facing wallets. The UI exposes only Wallet, Markets, Order, and Portfolio.

## Runtime boundaries

- `src/config/`: validates mobile build configuration and refuses an incomplete mainnet build.
- `src/wallet/trading/`: derives, restores, signs with, and safely rotates T.
- `src/integrations/umbra/`: resumable M-to-T funding and T-to-destination private withdrawal.
- `src/integrations/perps/pacifica/`: public market/candle/account reads, canonical signed actions, Solana USDC deposit, order validation, and resumable withdrawal.
- `src/integrations/perps/velocity/`: public on-chain market reads plus reviewed USDC-to-USDT conversion, account setup, collateral deposit, and market-order preparation.
- `src/integrations/solana/`: signed RPC, stablecoin conversion, transaction verification, submission, and confirmation.
- `workers/gateway/`: authenticated Solana RPC and verified Jupiter build gateway. Pacifica public and signed APIs are called directly because authentication is T's request signature, never a server credential.

Screens render state and collect intent. They do not construct Pacifica signatures, Velocity instructions, Solana deposits/swaps, Umbra proofs, or transaction bytes.

## Velocity trading

- The pinned official SDK is loaded only through browser-safe deep imports. A narrow Metro shim maps the SDK's `node-fetch` import to React Native's global fetch; no Node filesystem or WebSocket implementation enters the screen bundle.
- Public market rows come from subscribed mainnet market/oracle accounts. No 24-hour change or order-book value is fabricated when the on-chain surface does not provide it.
- Velocity quote collateral is mainnet USDT. USDC remains PerPal's primary T balance and is converted through the existing verified Jupiter route only after the user reviews and confirms that swap.
- A first order creates the T-owned Velocity account and deposits the required USDT; later orders deposit only the shortfall. Account setup, collateral movement, and order placement are separate explicit confirmations.
- The transaction builder is local. It rejects an unexpected program or signer, enforces the on-chain leverage and minimum-order constraints, checks T's SOL against the verified fee, persists a signed submission before confirmation, and never silently advances through another signature.
- Close, provider withdrawal, portfolio reconciliation, and rotation safety are still pending; the UI and documentation must not imply those stages are complete.

## Pacifica market data

- `GET /api/v1/info` is authoritative for symbol, tick/lot size, order limits, isolated-only state, and maximum leverage.
- `GET /api/v1/info/prices` supplies mark, oracle, funding, next funding, volume, open interest, prior price, and timestamp.
- `wss://.../ws`, subscription source `prices`, updates the REST snapshot. Older timestamps cannot overwrite a newer snapshot. Reconnect performs a fresh REST reconciliation.
- `GET /api/v1/kline/mark` supplies chart candles so analysis and executable risk use the same venue mark family.
- Missing or stale required data is unavailable, never replaced by an estimate. Trading is blocked until the mark is current.

## Market intelligence and notifications

- The Fear and Greed card uses Alternative.me's documented keyless `/fng/` API, validates and normalizes it at the Worker, and attributes the displayed reading to Alternative.me. The prior CoinMarketCap hostname was removed after live TLS verification failed.
- The public Worker route `GET /v1/market-briefing` normalizes configured CoinDesk, MarketWatch, and Federal Reserve RSS feeds plus FXMacroData's official U.S. economic calendar. These public sources require no Worker secret.
- News is source-attributed and time-stamped. Perps, U.S. crypto-policy, and Fed labels are derived only from words present in the returned articles.
- The event timeline includes only upcoming high-impact United States releases from the API's UTC calendar, including Fed events when the provider schedules them. It does not scrape or invent dates.
- The Home screen refreshes the briefing while focused and keeps the prior successful snapshot during a transient failure. The Worker cache bounds upstream traffic.
- A bounded, non-sensitive MMKV activity stream records private-wallet activation/rotation, funding, collateral deposit, order, cancellation, and private-withdrawal outcomes. It never stores addresses, transaction identifiers, signatures, amounts, or proofs. Current Pacifica gainers/losers and the latest relevant news are rendered live rather than persisted as repeated notifications.

## Signing and orders

T signs Pacifica's documented recursively sorted compact JSON with Ed25519. The app verifies the returned signature locally before submission. The signed header binds operation type, timestamp, and a five-second expiry window.

The MVP order surface implements market, limit, stop-market, and stop-limit entry plus full reduce-only market close. Before confirmation it shows side, exact base size, mark, notional, leverage, estimated taker fee, 0.5% slippage, Pacifica's available balance, T's USDC/USDT balances, and the market's API-provided minimum notional. Immediately before submission it refetches the market mark and rejects a stale or out-of-bound plan. Opening updates the chosen leverage and then submits the order; both requests are signed by T under the single confirmed intent. Open regular orders are readable and cancellable from Portfolio with a separate confirmation. An accepted market close is reconciled through Pacifica position/trade history before it is treated as filled.

Edit-order UI and individual stop-order management are not claimed as complete. Rotation uses Pacifica's authoritative stop-order count and refuses to proceed while any remain.

## Collateral and settlement

Pacifica standard deposits accept mainnet USDC only. USDT may be held privately in T but converts through the existing verified Jupiter route before a Pacifica deposit. The deposit instruction uses configured Pacifica program, central state, vault, and USDC mint addresses. It is simulated and its network fee, T balance, mint, authority, accounts, amount, and unsigned message are verified before T signs.

Pacifica withdrawal requests use a persisted UUID idempotency key. A retry reuses the same request and never creates a second withdrawal. The configured public withdrawal fee is displayed before confirmation. Once USDC reaches T, the existing Umbra private-exit state machine takes over.

The private-exit selector exposes only held assets present in the installed Umbra mainnet pool set; the relayer is checked again before funds move. Native SOL and any held wSOL are presented as one SOL balance. Umbra wraps native SOL during the T-side deposit and unwraps it in the relayed claim callback, so the destination receives native SOL without signing an unwrap. The preflight keeps enough native SOL in T for the deposit-stage rent and network fees. During rotation, no reserve remains stranded in old T: one atomic transaction moves its remaining SOL and empty-token-account rent into the next T after paying the exact rotation fee.

## Lifecycle audit decision: native SOL through Umbra

The installed `@umbra-privacy/sdk@5.0.0-rc.6` represents SOL with the native/WSOL mint inside the pool, but that is not the destination asset. Its generated public-claim instruction includes an MPC callback helper ATA: wrapped SOL moves through that helper and the program closes it to unwrap native SOL to the destination. PerPal therefore uses the same resumable Umbra path for the M-to-T fee reserve and T-to-destination SOL withdrawals. The earlier public-bootstrap and public-SOL-withdrawal assumptions were incorrect and have been removed.

## Privacy and custody boundary

- PerPal never holds M or T signing keys and never takes custody of funds.
- Umbra can obscure the direct M-to-T funding link only within its prover, indexer, relayer, and anonymity-set assumptions.
- T's Solana deposit and withdrawal activity is public and linkable to T.
- Pacifica can observe T's account, orders, positions, timing, and withdrawals. Pacifica uses off-chain matching and its documented hot/cold bridge custody model; venue collateral is not self-custodied by PerPal.
- The assistant can prepare an order but cannot confirm, sign, or submit it.

## Decision record: Pacifica and Velocity replace Flash and Adrena

Flash Trade was removed because it is shutting down. Adrena was removed after its available market set did not meet the product requirement. Hyperliquid was rejected because it does not preserve the required Solana stablecoin deposit path. Pacifica remains the USDC venue and Velocity is the USDT venue. Umbra always funds T first; provider-specific conversion and collateral movement occur only when a reviewed trade requires them.

All Flash integration modules, the Flash SDK dependency, ER configuration, internal fee signer, settlement provider, screens, hooks, and Worker provider flag were removed. A narrow storage parser still recognizes the old provider label only to avoid destroying a user's already persisted Umbra recovery record; it immediately normalizes that record to Pacifica and executes no legacy provider code.

## Release confirmation still required

Before calling the Pacifica migration device-confirmed, use a release-like build on a physical Android device with small mainnet amounts:

1. Restore Privy M and T after a cold app start.
2. Load REST markets, WebSocket price updates, and mark candles.
3. Fund T through Umbra and resume after an interruption.
4. Convert a small USDT shortfall if selected, deposit USDC to Pacifica, and verify account state.
5. Open and close the minimum position, verify rejection of an expired preview, and cancel an open order.
6. Withdraw Pacifica USDC and native SOL through Umbra to M and an external wallet; interrupt and resume each phase.
7. Verify T rotation rejects every non-zero token balance, regular/stop order, position, collateral, and pending operation, then recovers empty-account rent and remaining SOL into the next T.
8. Measure intent-to-submission and submission-to-Pacifica acknowledgement separately.
9. Select Velocity, convert a small USDC shortfall to USDT with a separate confirmation, create the account/deposit collateral, and open the smallest on-chain-accepted order.
10. After Velocity close/withdraw and rotation guards are implemented, verify settlement returns USDT to T and rotation refuses every open position, order, collateral balance, and pending action.
