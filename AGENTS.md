# PerPal Engineering Guide

## Scope and defaults

- Build the Expo mobile app and Cloudflare Worker backend as new systems. Do not assume prior folders, helpers, providers, routes, or data models exist.
- Start with a small number of clear boundaries: app configuration, authentication/signing, protocol integrations, API client, Worker handlers, and observability. Keep protocol code out of screens and keep rendering code out of protocol modules.
- Prefer platform capabilities and already-installed packages. Add a dependency only when it removes meaningful custom code and is compatible with the Expo SDK and native build.
- Do not start a local development server. Use focused static checks, unit tests, native builds, and deployed probes appropriate to the changed boundary.
- Treat wallet addresses, transaction bytes, signatures, circuit inputs, proofs, authorization headers, and secure-storage contents as sensitive. Never log secrets, private keys, seed material, raw proof data, or full authorization headers.

## Code organization and file limits

- Keep every hand-authored source file at or below 500 physical lines, including imports, comments, tests, and styles. Split a file before it approaches the limit; do not compress formatting or move unrelated code into comments to pass it. Generated native files, lockfiles, vendored code, and generated types are exempt.
- Keep `app/` limited to Expo Router route adapters and route layouts. Route files select a feature screen and declare navigation options; they do not own business logic, protocol calls, authentication flows, or large style sheets.
- Organize reusable code by boundary: `src/components/` for cross-feature UI and brand primitives, `src/features/<feature>/` for feature screens/components/hooks/state, `src/theme/` for semantic design tokens, `src/config/` for validated runtime configuration, and `src/integrations/` for Privy, wallet, protocol, API, and observability adapters.
- Build screens from small, typed components with one clear responsibility. Reuse an existing primitive before creating a screen-local duplicate; promote a component to `src/components/` when it is shared across features, not merely to shorten a file.
- Keep feature internals private to their feature. Import another feature only through an explicit public module, and never import route files from application code.
- Co-locate a component's styles with that component unless the values are semantic tokens. Do not create one global stylesheet or a generic helpers directory that becomes an unowned dependency bucket.
- Prefer composition and explicit props over copy-paste, inheritance, hidden global state, or configurable mega-components. Shared components must expose accessibility labels/states and support dynamic type, safe areas, and reduced motion where applicable.

## Perpal product constraints

- Build a private, non-custodial perpetuals client. The backend must never hold a user's signing key or funds; all signing stays on the device after an explicit confirmation.
- Keep the fast trade path separate from funding and privacy work. A trade may build, independently verify, sign, submit, and confirm; it must not wait for proving, funding settlement, long polling, or unrelated screen data.
- Treat the sub-50 ms execution goal as a real-device target to benchmark, not a promise inferred from an SDK. Measure intent-to-submission and submission-to-rollup acknowledgement separately.
- Funding is a staged, resumable, idempotent state machine. Persist each confirmed stage before advancing, resume safely after interruption, and never report an unresolved stage as complete.
- Before every signature, independently decode and verify the returned transaction against the user-confirmed intent: wallet, network, program, accounts, side, size, price, leverage, collateral, mint, fee, and expiry. Reject any mismatch or stale blockhash/quote.
- Preserve the privacy boundary honestly in product copy and error states: do not overstate what is hidden, who can observe it, or which trust assumption applies to a route.
- The assistant may prepare an order or explain an analysis, but the user must inspect and explicitly confirm every trade. It must not hold keys, sign, submit a transaction, or silently execute a recommendation.
- The PRD defines product priorities and the HLD defines the technical flow. When they conflict or a dependency changes its behavior, write a short decision record and validate on a physical device before implementation.

## Expo SDK and dependency policy

- Target the current stable Expo SDK 57. Do not use a canary release for a financial production build. Upgrade one Expo SDK at a time, read its release notes, and rebuild native binaries after every SDK or native-module change.
- Install Expo and React Native dependencies with `npx expo install`, never hand-picked versions. Run `npx expo install --check` in CI and `npx expo-doctor` before release; use `npx expo install --fix` only in a reviewed upgrade change.
- Use a custom development build and a release-like build for all native integrations. Expo Go is not a compatibility test for Privy, native proving, custom native modules, production observability, or a wallet handoff.
- Keep `react`, `react-native`, all `expo-*` packages, Router, Reanimated, Gesture Handler, Screens, Safe Area Context, and Worklets on the versions resolved by Expo SDK 57. Do not use `expo.install.exclude` to silence a mismatch unless the package owner documents the supported override and a native build has passed.

| Need | Dependency choice | Compatibility rule |
| --- | --- | --- |
| Native development | `expo-dev-client` | Install with Expo and validate all native integrations in a custom development build. |
| Navigation and lifecycle | `expo-router`, `react-native-screens`, `react-native-safe-area-context` | Install with Expo; keep providers at the root and screens lean. |
| Gestures and motion | `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets` | Install with Expo; validate the Babel/native setup in a development build before UI work. |
| Images, fonts, and launch | `expo-image`, `expo-font`, `expo-splash-screen`, `expo-asset` | Install with Expo; bundle only production assets and fonts. |
| Lists and server state | `@shopify/flash-list`, `@tanstack/react-query` | Use the current stable release compatible with the selected React version; test scrolling and cache invalidation on physical devices. |
| Secure local state | `expo-secure-store`; optionally `react-native-mmkv` for non-secret hot cache | Secrets and auth material stay in SecureStore. Never duplicate secret data into a fast cache. |
| Device security | `expo-crypto`, `expo-local-authentication`, `expo-application`, `@expo/app-integrity` | Install with Expo and test actual device attestation/biometric failure paths. |
| Production app metrics | `expo-observe` and EAS Observe | Requires Expo SDK 55+ and a native development or production build; install with Expo and use it for startup metrics. |
| Updates | `expo-updates` only when using EAS Update | Use a `fingerprint` runtime-version policy; configure all update endpoints through build configuration, never source literals. |
| Privy | `@privy-io/expo`, `@privy-io/expo-native-extensions`, plus Privy's Expo peer dependencies | Install the complete official peer set with Expo and test provider initialization in a custom build. |
| Solana client | Choose `@solana/kit` or `@solana/web3.js` per the selected Flash/Umbra/MagicBlock integration | Do not mix transaction models in screen code. Isolate any unavoidable adapter at the protocol boundary. |
| Optional external mobile wallet | `@wallet-ui/react-native-kit` and `react-native-quick-crypto` only when that wallet path is required | Follow the exact official sample/template compatibility set and initialize crypto before all Solana imports. |
| Umbra | Umbra SDK, native prover, and generated client from one verified compatibility set | Pin the exact compatible set; do not use independent `@latest` upgrades. Validate native proof generation and verification in a release-like build. |
| MagicBlock and Flash | Official client packages required by the selected execution design | Add only the required SDKs, lock their tested versions, and validate transaction semantics and rollup behavior on-device. |
| Cloudflare backend | `wrangler`, `hono`, and Workers type definitions | Keep a pinned, reviewed Worker toolchain; set a deliberate compatibility date and test every binding in a deployed environment. |

- Load required cryptographic polyfills before the Router and before any Privy, Solana, Umbra, or MagicBlock import. Privy's Expo setup requires `fast-text-encoding`, `react-native-get-random-values`, and `@ethersproject/shims`; add `buffer` only when the selected Solana client requires it.
- Use TypeScript `moduleResolution: "Bundler"` and preserve Metro package exports unless an upstream package documents a narrow resolver workaround. Keep each workaround isolated, commented with the upstream cause, and covered by a native build test.
- Use one Solana client model per transaction path. If a protocol requires a different model, convert only at its adapter boundary; never expose both transaction representations to feature screens.

## Configuration and Cloudflare Workers

- Define one typed configuration schema per runtime: build-time public mobile values, native-only values, and Worker bindings. Validate it at startup or request entry and fail closed when required configuration is missing or malformed.
- Every service origin, RPC endpoint, indexer/relayer endpoint, provider key, network-specific address, and runtime switch must be supplied by configuration. Source code must not contain a public endpoint fallback or literal endpoint URL.
- Use `EXPO_PUBLIC_*` only for values that are safe to embed in the mobile binary. Put credentials in Worker secrets or native secure storage; never expose them through Expo config, a public variable, source code, telemetry, or error text.
- Declare non-secret Worker bindings in the appropriate Wrangler configuration and set credentials through Worker secret management. Test the deployment with the same binding names that production uses.
- Keep Worker handlers narrow: validate request method, content type, size, schema, authorization, and network before any upstream call. Apply explicit CORS allowlists, exact methods/headers, `Vary: Origin`, rate limits, and abortable upstream timeouts.
- A gateway must allow only the RPC methods the app needs. Validate batch entries independently. If an upstream provider rejects batched requests, fan out validated entries server-side and restore the original response order; never turn the Worker into an unrestricted proxy.
- Return stable, typed error codes and safe messages. Preserve the underlying cause only in redacted server diagnostics.
- Sign or MAC sensitive requests with a short-lived nonce, timestamp, wallet/device binding, network, method, and canonical body hash. The Worker verifies all of them, enforces clock skew and one-time nonce use, and rejects replayed or cross-network requests.
- Require an idempotency key for every state-changing API request. Store its final result by authenticated wallet and operation; a retry must return the original result and never create another submission.
- Use service bindings for Worker-to-Worker calls inside the same account. Do not route internal traffic through a public hostname just to call another Worker.
- Keep global Worker scope cheap: no large data parsing, eager SDK initialization, dynamic key generation, or provider warm-up. Stream large request/response bodies, cap all accepted payloads well below platform limits, and bound fan-out/subrequests.
- Use `ctx.waitUntil()` only for bounded non-critical work such as an external telemetry event or cache write. Do not place signing, authorization, idempotency persistence, execution, confirmation, or fund-state transitions there. Use Workers Analytics Engine directly for custom metrics because its writes are non-blocking.

## Financial correctness and market data

- Store and calculate token amounts, prices, fees, collateral, leverage, and PnL in base units or exact decimal strings. Never use JavaScript floating-point arithmetic as the source of truth for money, margin, or a signed transaction.
- Centralize decimal conversion, rounding direction, display precision, and locale formatting. A value displayed to the user must be the value checked before signing; the display layer must not independently recalculate a trade amount.
- Bind every quote to its instrument, side, size, collateral, slippage limit, price, expiry, and network. Reject a quote that is stale, mismatched, expired, or cannot be independently verified; rebuild it rather than silently changing the order.
- Treat provider data as a feed, not truth. Attach source and timestamp to price, funding, position, signal, and backtest data; show a clear stale/unavailable state and block execution when the required quote or risk data is no longer valid.
- Reconnect streams with bounded exponential backoff and jitter. On a sequence gap, reconnect, refetch the authoritative snapshot, and reconcile state before rendering it as final. Never let a stale stream overwrite a newer snapshot.
- The position and order UI must make leverage, liquidation threshold, collateral, fees, funding, order status, and available withdrawal amount legible before confirmation. Do not hide risk behind a secondary screen or a generic warning.
- Backtests and AI analysis must label data range, instrument, assumptions, fees, source, timestamp, and limitations. Do not fabricate historical results, confidence, market activity, or citations.

## AI action boundary

- Convert model output into a typed action draft, never directly into an SDK call or transaction. Validate the draft server-side and client-side, show the complete trade/risk summary, then require the user's explicit confirmation and local signature.
- Keep the model's context minimal and redacted. Do not provide secrets, seed material, raw proofs, full transaction bytes, or more wallet history than the requested analysis needs.
- Every market claim, signal, and recommendation must identify its source time and confidence. Missing, stale, conflicting, or unverifiable data produces an unavailable state, not a confident-looking answer.
- The AI proxy may assist with language and analysis; it is never an authorization boundary, signer, custody layer, or execution engine.

## Privy and Solana signing

- Create one Privy provider boundary near the application root. A production build must fail fast when its public app/client identifiers are missing or invalid.
- Provision only the supported Solana embedded wallet type. Expose it through one signing adapter that owns wallet discovery, reconnect handling, message signing, legacy transaction signing, and versioned transaction signing.
- Validate every signature and signed transaction returned by the provider before it reaches protocol code. Do not call the provider directly from screens or create parallel signer registries.
- Bind every signing request to the currently selected wallet and explicit user confirmation. Never silently change wallet identity, retry a rejected signature, or treat a missing signature as a submitted transaction.
- Store only the minimum sensitive client material in platform secure storage. Clear identity-scoped caches and in-flight work when the active wallet or network changes.

## Umbra SDK and native Groth16 proving

### Non-negotiable prover rules

- Keep the Umbra SDK, native prover, generated client, deployed programs, circuit assets, and asset manifest compatible as one release unit. An upgrade is a native-build change, not a JavaScript-only change.
- Create dedicated integration modules for signer adaptation, provider construction, native proving, proof-error classification, and execution orchestration. Screens and hooks orchestrate state; they must not construct circuit inputs, SDK clients, or proof flows.
- Check native prover availability before enabling a proving action. Initialize the native module once. A missing or incompatible module requires a rebuilt native app; never substitute web proving, JavaScript proving, a different native crate, or a silent fallback.
- Generate with Rapidsnark first and use Arkworks only as the fallback. Return proof bytes only after the same native backend verifies the generated proof locally. A locally invalid proof must never be submitted.
- Keep circuit wrappers and input shapes explicit. Receiver claims may use their supported batch variants; self-claims use a dedicated `n1` wrapper with `maxUtxoCapacity: 1`. Never reuse a receiver-claim prover or infer a larger self-claim capacity.
- Treat every proving asset as versioned native compatibility data. Resolve its manifest endpoint from typed configuration. Cache the manifest version, asset version, expected byte count, and local path; reject missing, undersized, truncated, or size-mismatched files before proving.
- Reconcile the local manifest with the remote manifest before trusting a cache entry. Invalidate the asset cache when its top-level manifest version changes. A non-empty file is not sufficient evidence that an asset is usable.
- Refresh an asset once only when there is stale-asset evidence, such as a native Rust panic. Preserve both the original failure and refresh failure in redacted diagnostics. Do not repeatedly clear caches or retry generic proof, signing, relayer, or RPC errors.
- Keep proving out of render, animation, and press-feedback paths. Enforce a single in-flight prove/submit action per wallet and request, show deterministic progress, and retain unresolved action state across an app interruption.
- Never log circuit inputs, witness data, raw proofs, secret material, or wallet signing payloads. Safe diagnostics are circuit/asset label, manifest version, file byte count, native backend, duration, and redacted error class.

### Groth16 claim failure classification

- A Groth16 verification failure is a hard claim failure, never a transient relayer failure. Detect `UnableToVerifyGroth16Proof`, custom error `14005`, and program error `0x36b5` in plain messages and nested RPC/JSON error structures.
- Implement one `isGroth16ProofVerificationFailure()` guard. It must run before every generic relayer, RPC, timeout, or retry classification, including the helper that decides whether a relayer error is transient.
- A wrapped transaction-pipeline or send-transaction error does not make a contained Groth16 failure retryable. Identify proof verification in the user-safe error, stop automatic retry, and preserve the redacted underlying reason for diagnosis.
- A failed batch remains unresolved. Never mark it completed, claimed, or removable because a relayer omitted per-item IDs. A non-null failure reason is authoritative and must block every success fallback.
- Account for receiver and self-claim results independently. In a partial result, resolve only confirmed indices and return unresolved indices with the first failure reason. In a total failure, throw that reason rather than returning a success-shaped result.
- Test each proof marker alone and inside relayer/RPC wording, nested `Custom`/`InstructionError` values, invalid local verification, backend fallback, stale-asset refresh, and the self-claim `n1` route.

## MagicBlock execution

- Isolate transaction construction, plan validation, signing, broadcast, and confirmation in one protocol module. Screens select a route, request an action, and render state; they do not duplicate protocol logic.
- Statically import code required by a mounted screen's normal interaction path. A callback-level dynamic import can break the Metro module table; use it only for a genuinely optional boundary that is validated in a native build.
- Resolve all network and endpoint values from typed configuration or a verified backend capability response. Validate the prepared plan, selected wallet, network, and signer identity immediately before signing.
- Enforce single-flight, idempotent submission. Disable duplicate actions while preparing, signing, broadcasting, or confirming. Persist a minimal submission record before confirmation polling so an interrupted session can recover safely.
- Classify failures by phase: preparation, user rejection, signing, broadcast, confirmation, or protocol rejection. Do not report a phase failure as a generic success, and do not resend unless idempotency is proven.

## Product UX direction and accessibility

- Direction: quiet, industrial trading workstation — compact where decisions are made, calm elsewhere. The trade ticket, current position, and live risk have visual priority; learning and analysis use a more comfortable reading density.
- Use a restrained semantic palette with one accent for the primary action and clear risk colors reserved for actual states. Choose typography, radii, spacing, and elevation intentionally before implementation; do not default every section to an identical rounded card.
- Prefer a few structural panels over nested cards, centered hero metrics, decorative glass, dashboard filler, gradients, fake activity, or casino-like effects. Copy must be specific to the shown instrument, position, data source, or action.
- Keep primary and destructive actions visibly distinct. Before a signature, present a compact, scannable confirmation with the action, asset, amount, price, leverage, fees, risk, and expiry — no hidden swipe or ambiguous icon-only approval.
- Support dynamic type, screen readers, keyboard navigation, sufficient contrast, semantic labels, live-region status for progress/errors, and touch targets large enough for one-handed use. Do not convey a trade state or error by color alone.
- Errors persist until the user can act; success feedback is brief and does not obscure the next decision. Empty states explain the missing prerequisite and provide one clear next action.

## Expo UI, responsiveness, and motion

- Build every screen for small phones, large phones, cutouts, keyboard visibility, dynamic type, and reduced-motion preferences. Use safe-area-aware flexible layouts, scroll containers, and adequate touch targets; avoid fixed viewport measurements.
- Define semantic design tokens before building screens: colors, spacing, radii, elevations, and a compact typography scale. Bundle fonts at build time and assign clear roles: UI text, display text, numerical values, and monospaced technical values. Do not load fonts at runtime or invent screen-local font rules.
- Keep the UI data-led and quiet. Show real labels, amounts, status, useful empty states, and actionable errors. Do not add invented metrics, decorative dashboards, fake activity, generic crypto imagery, excessive gradients/glass, or verbose marketing copy.
- Use a supported UI-thread animation library such as `react-native-reanimated` for interactive motion. Drive press feedback with shared values and supported springs; use transforms and opacity. Use asset animation only for a purposeful, non-blocking visual.
- Do not use React state, timers, loops, or synchronous JavaScript work to drive an animation. Timers are allowed only for bounded polling, debounce, cancellation, and recovery work, with cleanup.
- Keep expensive parsing, serialization, proving, derivation, and list transformation out of render and input handlers. Defer non-visible work until after the current interaction, cancel it when its request becomes stale, and keep one owner for each refresh.
- Use virtualized lists for unbounded data. Cache deliberate reads, cancel obsolete requests, and deduplicate refreshes triggered by focus, pull-to-refresh, reconnect, or streaming updates.
- Render a usable first screen before non-critical prefetch, analytics, asset warming, and background synchronization. Never stage a screen reveal with arbitrary timers; show a stable skeleton only while the data required for that screen is genuinely pending.
- Keep remote data in the query cache and short-lived interaction state local to the feature. Do not mirror server data through multiple stores, persist unbounded query data, or refetch every screen on focus.
- Use `expo-image` with correctly sized, cached image sources; prefetch only assets needed by the next likely screen. Do not decode large images, parse large JSON payloads, or map unbounded arrays on the initial render.
- Use `AbortController` for every fetch that can become irrelevant. A new wallet, network, route, search term, quote, or manual refresh cancels the prior request instead of letting a stale response overwrite fresh state.
- Keep the hot trade UI lean: a local confirmation state, a verified transaction, one signing request, one submission record, and status updates. Move analytics and non-essential refreshes off that interaction path.
- Respect reduced-motion settings. Animate only transform and opacity for primary interactions, avoid layout thrash, and test input-to-feedback on a low-tier physical device before accepting a motion change.
- Use error boundaries around independent screen areas and recoverable protocol steps. An error in a chart, feed, or auxiliary panel must not freeze the navigation shell or discard a pending transaction state.

## Performance instrumentation and budgets

- Instrument before optimizing. Use monotonic durations such as `performance.now()` and structured events; never diagnose responsiveness from a subjective impression alone.
- Every telemetry event includes: release/build identifier, trace ID, span ID, route or operation name, coarse device class, network name, outcome, typed error code, and duration. Do not include secrets, raw wallet data, transaction bytes, proof data, or full URLs.

| Area | Required measurements | Debug value |
| --- | --- | --- |
| App startup | process start, configuration ready, authentication ready, first screen committed, first usable interaction | separates boot, configuration, auth, and rendering delay |
| UI interaction | input received, visual feedback started, navigation requested, screen committed, long JS task count | exposes delayed feedback, slow transitions, and render stalls |
| Client request | request start/end, method, route, status, response bytes, retry count, cancellation reason | identifies request storms, payload bloat, retry loops, and stale work |
| Worker request | handler total, auth, validation, cache, upstream fetch, serialization, status, timeout, error code | isolates Worker CPU, binding, cache, and upstream latency |
| Native/protocol action | module availability, asset preparation, proof generation, local verification, signing, broadcast, confirmation | locates a failure without exposing sensitive inputs |

- Emit request timing in a `Server-Timing` header and carry the same trace ID from the mobile request through every Worker and upstream call. Log structured redacted spans at each boundary.
- Record aggregate p50, p95, and p99 latency, error rate, cancellation rate, retry rate, cache-hit rate, Worker CPU/time-limit events, crash rate, native-module initialization failures, and interaction stalls. Break dashboards down by release, operation, network, and coarse device class.
- Establish a baseline on representative low-, mid-, and high-tier physical devices. Define and enforce budgets for time to first usable screen, input-to-feedback, screen transition, API p95, Worker p95, payload size, proof duration, crash-free sessions, and stall rate. Alert on regression from the baseline rather than arbitrary single samples.
- Sample successful performance events at a configurable rate and retain all redacted error events. Make telemetry enablement, endpoint, and sampling rate configuration values, not source-code constants.
- Send non-critical telemetry with the Worker execution context so it cannot delay an authenticated API response. Cap event size, batch only bounded events, and drop telemetry rather than delaying a trade, signature, or confirmation.
- Track client memory pressure, JavaScript exceptions, native crashes, and app-state transitions alongside latency. Correlate them to a release and trace ID so a perceived freeze can be distinguished from a slow provider, a render stall, a native-module failure, or an app-switching delay.
- Monitor Worker CPU time, wall time, memory-limit errors, startup time, subrequest count, and invocation status per route. Profile a CPU or memory regression before raising Worker limits; increasing the limit is not a fix for avoidable parsing, fan-out, or global initialization.
- Keep Worker bundles small and split unrelated duties when a deployment approaches startup or bundle-size limits. Do not bundle binary assets, large registries, or expensive data transforms into a hot request handler.

## Debugging rules

- Start from evidence: exact release, device/OS, active wallet/network context, route, timestamp, typed error, trace ID, and the observed request sequence. Trace the active code path end to end before changing it.
- Use the trace ID to correlate mobile timing, Worker logs, upstream timing, and native/protocol spans. Compare configuration by binding name and presence, never by printing secret values.
- Classify the failing boundary before proposing a fix: UI/render, app state, authentication/signing, native module, Worker validation, Worker configuration, upstream provider, or on-chain/program result. Fix the shared root cause, not one visible caller.
- Separate scheduled/background Worker failures from live request failures. A CPU-limit or cron log is not evidence of a client-route failure unless the same trace shows that path.
- For RPC problems, capture the validated method, batch shape, request size, response status, and provider timing. Check Worker allowlists and upstream batch compatibility before blaming a wallet or protocol SDK.
- For native build or Metro failures, use the exact stack/module identifier, inspect the importing screen path, then validate a rebuilt native binary. Do not paper over a module-table failure with retries.
- For UI slowness, inspect interaction timing, render count, long JS tasks, request count, payload size, and stale-refresh cancellation before changing animation or layout code.
- For proof failures, preserve the circuit label, asset manifest/version, backend, local-verification outcome, phase, and typed error classification. Do not reduce a proof-verification failure to a generic network error.
- Reproduce one variable at a time. Add the smallest focused regression test at the shared boundary, rerun the narrow test first, then typecheck, lint, and validate the real integration path before closing the issue.

## Quality gate

- Each new protocol, Worker handler, and non-trivial state transition gets focused tests for success, malformed input, cancellation, timeout, idempotency, and error classification.
- Run `npx expo install --check`, `npx expo-doctor`, the project test suite, TypeScript checks, lint, formatting/diff checks, and the affected Worker checks for every dependency or SDK update. Native integrations require a native build; a JavaScript-only check is not proof of native compatibility.
- Presentation-only changes are the one scoped exception: when a change touches nothing but styles, design tokens, SVG or other static assets, copy, and layout inside `app/` or `src/`, run `npx tsc --noEmit` alone. Do not run a native build, bundle export, lint sweep, dependency check, or doctor pass for that change, and do not claim device-verified results from it. The moment the change also touches a dependency, native module, config plugin, `app.config.ts`, entry order, or any protocol/Worker boundary, the full quality gate applies again.
- Validate deployments with real environment bindings and a redacted end-to-end trace. Do not declare an integration complete based only on static checks.
- Test cold start, warm start, low-tier hardware, app-switching during signing, connectivity loss during a state transition, stale quote recovery, duplicate submission, Worker restart, provider timeout, and rollback of a mobile update before a production release.
- Keep a lockfile, review dependency diffs, pin protocol-native compatibility sets, and remove unused packages before release. Do not add a monitoring, state, animation, or UI dependency unless a measured gap justifies its native and bundle cost.
- Roll out native builds and remote updates progressively with an explicit rollback path. A native-module, SDK, or protocol compatibility change requires a new compatible runtime; never ship it as a JavaScript-only update.
