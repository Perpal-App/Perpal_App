# PerPal idea context

## Landscape

- Product: Android-only private perps client using Privy wallet M, Umbra funding, and device-held trading wallet T.
- Removed direction: the retired Flash provider, because the venue is shutting down.
- Implemented provider: Pacifica. Physical Android confirmation remains for T message signing, USDC deposit, order placement, close, cancellation, and withdrawal.
- Rejected for the current MVP:
  - Velocity: post-fork audit still in progress and hosted Data/DLOB endpoints are provisional.
  - Jupiter Perps: strongest Solana liquidity, but its official third-party Perps API is still documented as work in progress.
  - Drift legacy: paused after the April 2026 exploit and awaiting a security-first relaunch.
  - BULK: promising signed API, but browser signing SDK and production integration surface are still maturing.
- Non-negotiable boundary: Umbra can obscure M to T funding; venue deposits, orders, positions, and withdrawals remain observable or attributable to T and the venue.
- Product rule: Pacifica standard deposits are USDC-only. USDT remains supported inside T and converts to USDC on demand before a provider deposit.
