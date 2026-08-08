# ADR-002: Pacifica is the sole perps provider

- Date: 2026-08-08
- Status: accepted and implemented locally; physical Android confirmation pending

## Decision

Use Pacifica as PerPal's sole perpetuals venue. Keep Privy M, Umbra, and private wallet T unchanged. T signs Pacifica requests locally after explicit confirmation. Pacifica receives only USDC; USDT remains a supported T funding asset and converts on demand before deposit.

## Consequences

- Public markets and charts do not require a wallet signature.
- Venue collateral and trades are attributable to T and visible to Pacifica.
- Pacifica's off-chain matcher and hot/cold bridge are explicit trust assumptions.
- No provider SDK is bundled; the adapter uses Pacifica's documented REST, WebSocket, signing, and Solana deposit formats.
- Retired provider code and dependency are deleted. Only a persisted Umbra-record compatibility read remains, because deleting recovery state could strand funds.

## Sources

- https://docs.pacifica.fi/api-documentation/api/signing/implementation
- https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-market-info
- https://docs.pacifica.fi/api-documentation/api/rest-api/orders/create-market-order
- https://docs.pacifica.fi/trading-on-pacifica/deposits-and-withdrawals
- https://docs.pacifica.fi/support/deposit-withdrawal
- https://docs.pacifica.fi/api-documentation/api/rest-api/account/request-withdrawal
- https://github.com/pacifica-fi/python-sdk/blob/main/rest/deposit.py
