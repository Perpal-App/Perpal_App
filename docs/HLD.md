# Perpal Android MVP HLD

## Product flow

1. Privy creates public wallet **M** after sign-in or automatically provisions the same M onto a new device for the same Privy app and authenticated user.
2. The user activates private trading once. A fixed M signature deterministically creates or recovers private wallet **T**; normal sessions restore T from Android secure storage without an unlock step.
3. Public market data loads without a wallet signature. The user chooses Flash Trade v2 or Velocity.
4. Funding is one resumable operation: the user independently selects USDC or USDT, M deposits it and a user-chosen SOL fee reserve into Umbra, and Umbra's relayer claims them into T. If the selected provider requires the other stablecoin, T converts through a verified Jupiter Swap v2 plan with a 0.5% slippage ceiling before Perpal initializes and funds the provider.
5. A trade is prepared from live provider state, decoded, simulated, shown to the user, and signed locally by T only after explicit confirmation.
6. Closing a position queues provider settlement immediately. Position proceeds move to T without a separate user action.
7. **Withdraw privately** first pulls any safe free provider collateral into T, then deposits from T into Umbra and relays the private claim to M or another Solana wallet.
8. T rotation is allowed only after T, the internal Flash fee signer, both providers, and all resumable operations verify empty.

Provider basket/user accounts are protocol implementation details, not extra wallets or user-facing onboarding steps.
The UI exposes only funding, trade confirmation, portfolio state, and private withdrawal; note IDs, relayer stages, helper signers, and provider-account transactions remain recovery internals.
The authenticated Android shell has three destinations: **Markets** for public prices and orders, **Portfolio** for positions and withdrawal, and **Wallet** for one-time private activation, funding, rotation, and sign-out. The app opens on Markets; an empty dashboard is not a separate destination.

## Runtime boundaries

- `src/features/`: screens, confirmations, and progress only.
- `src/integrations/privy/`: M provisioning and Privy signing.
- `src/wallet/trading/`: T derivation, local signing, restore, and rotation.
- `src/integrations/umbra/`: resumable M-to-T funding and T-to-destination private exit.
- `src/integrations/perps/flash/`: Flash ER quotes, orders, portfolio, funding, and settlement.
- `src/integrations/perps/velocity/`: Velocity accounts, isolated orders, portfolio, funding, and settlement.
- `workers/gateway/`: authenticated bounded Solana RPC, stablecoin swap-build proxy, and public market-data routes.

## Position isolation

Velocity entry orders transfer only that market's required margin and fee into its isolated balance. A close creates a settlement record keyed by market index. Flash settlement records are keyed by market and side. Recovery processes records independently and polls pending confirmations in the background, so a failed or slow settlement does not block another position or trade.

## Fees

Perpal has no paymaster and sponsors no transaction fee.

- M pays Umbra deposit transactions.
- Umbra's public relayer pays claim transaction fees and deducts its declared fee from the note.
- T receives the user-selected SOL reserve privately and pays provider/trade transactions.
- T pays any USDC/USDT conversion transaction and receives the complete verified output before provider funding.
- Flash requires a fee payer distinct from T for withdrawal actions. Perpal deterministically derives an internal signer **S** from T, funds S from T on demand using current network fee and rent requirements, and keeps unused/refunded rent under the user's local signer. There is no fixed 0.05 SOL cap.

With no sponsor, the final native SOL in T cannot privately deposit itself while also paying that deposit transaction's fee. The Android MVP therefore keeps unused SOL as the user's reusable trading-fee reserve and blocks rotation until T and S are empty; it does not pretend an exact private SOL sweep exists.

## Privacy boundary

Umbra breaks the direct public M-to-T transfer link under Umbra's prover, indexer, relayer, and anonymity-set assumptions. Once funded, T's Solana and provider activity is publicly observable and linkable to T. Flash's helper signer S is publicly linkable to T but not directly to M. Provider choice, positions, orders, and timing are not hidden from the selected protocol.

## Decisions resolving earlier document conflicts

- Mainnet-only replaces all devnet flows and labels.
- Flash Trade v2 and Velocity are selectable providers; neither is presented as a separate wallet.
- USDC and USDT selection is independent from provider selection. Flash currently settles internally in USDC and Velocity in USDT, so a mismatched choice converts inside T instead of silently switching providers.
- Market data is public and unsigned; only financial transactions require confirmation and a local T signature.
- “Unlock wallet” is removed. Secure restore is automatic after the one-time activation.
- Privy Solana wallet creation uses `all-users` with Privy recovery. Reinstalling or changing devices restores M after the same user signs in; it does not import a wallet belonging to another Privy app, another Privy user, or an arbitrary external seed.
- Device attestation is a pre-publication hardening item, not an Android prototype blocker.
- The user requested automatic settlement, so provider withdrawal is part of the background close/private-exit orchestration rather than a separate screen.

## Release gate

TypeScript success proves only static integration. MVP completion still requires a release-like build on a physical Android device using small mainnet amounts to validate Privy activation, Umbra native proving/relay, both provider open and close transactions, automatic settlement, private withdrawal, interruption recovery, and rotation rejection/success paths.
