# Build context

```yaml
mobile:
  platform: react-native
  wallet_method: embedded
  scaffold_repo: perpal
  physical_device_tested: partial
  perps_provider: pacifica
  provider_integration_status: implemented_locally_device_confirmation_pending
debug:
  issues_resolved:
    - error: funding rejected before blockchain submission
      cause: Umbra current-scheme scanning bypassed persisted master-seed storage and requested a second recovery signature; dynamic indexer loading could also leave fetchers unavailable in Metro
      fix: route the current Umbra scheme through persisted master-seed storage and statically wire the configured indexer fetchers
    - error: first Umbra scan still rejected locally
      cause: concurrent Umbra key derivations both invoked the non-memoized first-use master-seed generator, creating overlapping Privy signature requests
      fix: single-flight master-seed access across the base client and current scheme, resetting only after a failed request
    - error: native Umbra deposit proof failed with a Rust panic and Arkworks local-verification failure
      cause: rn-zk-prover 5.0.0 was paired with v3 proving assets and PerPal serialized scalar Circom signals as strings instead of Mopro's required string arrays
      fix: pin the matching v5 manifest and zkeys, then serialize every top-level Circom signal as a flat string array
    - error: Umbra deposit simulation returned AccountNotInitialized 3012 for depositor_user_account
      cause: the public Privy wallet M had not completed Umbra's required user registration
      fix: run the SDK's idempotent confidential and anonymous registration inside the existing funding action before deposit preparation
    - error: Solana Kit createPrivateKeyFromBytes failed while deriving Umbra registration keys
      cause: Android Web Crypto lacked Ed25519 importKey support required by the installed Solana Kit keys package
      fix: install the official Solana Kit Ed25519 Web Crypto polyfill before any Solana import
    - error: Expo Crypto digest rejected an ArrayBuffer passed by the Ed25519 polyfill
      cause: Expo's native digest boundary accepts a TypedArray input
      fix: normalize each BufferSource to a fresh Uint8Array before calling Expo Crypto digest
    - error: Umbra anonymous registration failed to establish a WebSocket computation subscription
      cause: the configured authenticated Worker is an HTTP JSON-RPC endpoint and does not expose Solana WebSocket subscriptions
      fix: inject Umbra's documented HTTP polling computation monitor through the signed RPC adapter and allowlist its required callback-signature read
  last_debug_session: 2026-08-07T15:00:00+05:30
```
