import type { Amount } from '@/domain/money/amount';

/**
 * The `PerpsVenue` port.
 *
 * Everything above this boundary — screens, domain logic, the AI draft pipeline —
 * depends only on these types. Nothing here references a protocol SDK, so a
 * both Drift and Flash Trade v2 present an identical mainnet surface.
 *
 * Two deliberate choices:
 *
 * 1. Order kinds are a discriminated union, not one struct with optional fields.
 *    A limit order without a price, or a stop without a trigger, is
 *    unrepresentable rather than validated at runtime.
 * 2. Venues declare capabilities instead of silently emulating what they lack.
 *    If Flash supports something Drift does not, the difference surfaces as an
 *    explicit refusal, never as a quietly different execution.
 */

/** Base58 account address. Branded so a raw string cannot be passed by mistake. */
export type Address = string & { readonly __brand: 'Address' };

/** Venue market identifier, e.g. `SOL-PERP`. */
export type MarketSymbol = string & { readonly __brand: 'MarketSymbol' };

/** Opaque, venue-assigned order identifier. */
export type OrderId = string & { readonly __brand: 'OrderId' };

/** Local position identifier. Never an account key — see the AI rules in §5. */
export type PositionId = string & { readonly __brand: 'PositionId' };

export type Side = 'long' | 'short';

/** A price expressed in quote-currency base units. */
export type Price = Amount;

export type Market = {
  readonly symbol: MarketSymbol;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly maxLeverage: number;
  readonly minOrderSize: Amount;
  /** Venue index or id, kept opaque so callers cannot compute with it. */
  readonly venueRef: string;
};

export type OraclePrice = {
  readonly symbol: MarketSymbol;
  readonly price: Price;
  readonly publishedAtMs: number;
  /** Slot or sequence the quote came from, for staleness checks. */
  readonly sequence: bigint;
};

export type FundingRate = {
  readonly symbol: MarketSymbol;
  /** Basis points per funding interval. Signed: positive means longs pay. */
  readonly rateBps: number;
  readonly intervalSeconds: number;
  readonly nextFundingAtMs: number;
};

export type BookLevel = {
  readonly price: Price;
  readonly size: Amount;
};

export type L2Book = {
  readonly symbol: MarketSymbol;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly sequence: bigint;
  readonly capturedAtMs: number;
};

/* ---------------------------------------------------------------- orders --- */

export type TimeInForce = 'immediate-or-cancel' | 'good-till-cancelled';

export type OrderKind =
  | { readonly type: 'market' }
  | { readonly type: 'limit'; readonly price: Price; readonly timeInForce: TimeInForce; readonly postOnly: boolean }
  | { readonly type: 'stop-market'; readonly triggerPrice: Price }
  | { readonly type: 'stop-limit'; readonly triggerPrice: Price; readonly price: Price }
  | { readonly type: 'take-profit-market'; readonly triggerPrice: Price }
  | { readonly type: 'take-profit-limit'; readonly triggerPrice: Price; readonly price: Price };

/**
 * What the user confirmed. This is the contract the verification gate checks the
 * built transaction against, so it must contain everything that affects outcome.
 */
export type OrderIntent = {
  readonly market: MarketSymbol;
  readonly side: Side;
  readonly kind: OrderKind;
  /** Position size in base-asset units. */
  readonly size: Amount;
  readonly leverage: number;
  readonly reduceOnly: boolean;
  /** Oracle sequence the risk preview was computed from. */
  readonly quotedAtSequence: bigint;
};

export type RiskPreview = {
  readonly estimatedEntry: Price;
  readonly liquidationPrice: Price | null;
  readonly initialMargin: Amount;
  readonly estimatedFee: Amount;
  readonly notional: Amount;
};

/* ---------------------------------------------------- verify before sign --- */

export type VerificationFailure =
  | { readonly reason: 'market-mismatch' }
  | { readonly reason: 'side-mismatch' }
  | { readonly reason: 'size-mismatch'; readonly expected: Amount; readonly found: Amount }
  | { readonly reason: 'price-mismatch'; readonly expected: Price; readonly found: Price }
  | { readonly reason: 'leverage-mismatch' }
  | { readonly reason: 'reduce-only-mismatch' }
  | { readonly reason: 'unexpected-instruction'; readonly programId: Address }
  | { readonly reason: 'unexpected-writable-account'; readonly account: Address }
  | { readonly reason: 'stale-quote'; readonly quotedAt: bigint; readonly current: bigint }
  | { readonly reason: 'stale-blockhash' }
  | { readonly reason: 'undecodable' };

export type VerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: readonly VerificationFailure[] };

/**
 * An unsigned transaction plus the intent it claims to fulfil.
 *
 * Serialized bytes, not an SDK transaction object, so the two venue adapters can
 * pin different `web3.js` copies without their classes ever meeting.
 */
export type PreparedOrder = {
  readonly intent: OrderIntent;
  readonly unsignedTransaction: Uint8Array;
  readonly risk: RiskPreview;
  /** Wall-clock deadline after which this must be rebuilt, never blind-signed. */
  readonly expiresAtMs: number;
  /** Idempotency key so a retry cannot place a second order. */
  readonly idempotencyKey: string;
};

export type SubmissionResult =
  | { readonly status: 'confirmed'; readonly signature: string; readonly orderId: OrderId | null }
  | { readonly status: 'rejected'; readonly phase: SubmissionPhase; readonly retryable: boolean };

/** Where a submission failed, which determines whether a retry is safe. */
export type SubmissionPhase =
  | 'build'
  | 'verify'
  | 'sign'
  | 'broadcast'
  | 'confirm';

/* ------------------------------------------------------------- portfolio --- */

export type Position = {
  readonly id: PositionId;
  readonly market: MarketSymbol;
  readonly side: Side;
  readonly size: Amount;
  readonly entryPrice: Price;
  readonly markPrice: Price;
  readonly unrealisedPnl: Amount;
  readonly liquidationPrice: Price | null;
  readonly leverage: number;
};

export type OpenOrder = {
  readonly id: OrderId;
  readonly market: MarketSymbol;
  readonly side: Side;
  readonly kind: OrderKind;
  readonly size: Amount;
  readonly filledSize: Amount;
};

export type MarginSummary = {
  readonly equity: Amount;
  readonly freeCollateral: Amount;
  readonly maintenanceMargin: Amount;
  /** Withdrawable balance, which excludes collateral locked as margin. */
  readonly withdrawable: Amount;
};

/* ------------------------------------------------------------ capability --- */

/**
 * Declared per venue so unsupported operations fail loudly. Drift and Flash
 * differ, and pretending otherwise is how a "supported" order type
 * silently becomes a different one.
 */
export type VenueCapabilities = {
  readonly venueId: string;
  readonly cluster: 'mainnet';
  readonly orderKinds: readonly OrderKind['type'][];
  readonly collateralMints: readonly Address[];
  readonly supportsPostOnly: boolean;
  readonly supportsReduceOnly: boolean;
  readonly supportsCrossMarketMargin: boolean;
  /** True when resting orders are executed by a keeper the venue operates. */
  readonly restingOrdersNeedKeeper: boolean;
};

export class UnsupportedByVenueError extends Error {
  constructor(readonly capability: string, venueId: string) {
    super(`Venue "${venueId}" does not support ${capability}.`);
    this.name = 'UnsupportedByVenueError';
  }
}

/* ----------------------------------------------------------------- port --- */

export type Unsubscribe = () => void;

export type PerpsVenue = {
  readonly capabilities: VenueCapabilities;

  listMarkets: () => Promise<readonly Market[]>;
  getOraclePrice: (market: MarketSymbol) => Promise<OraclePrice>;
  getFundingRate: (market: MarketSymbol) => Promise<FundingRate>;
  getL2Book: (market: MarketSymbol, depth: number) => Promise<L2Book>;

  getPositions: (owner: Address) => Promise<readonly Position[]>;
  getOpenOrders: (owner: Address) => Promise<readonly OpenOrder[]>;
  getMarginSummary: (owner: Address) => Promise<MarginSummary>;

  previewRisk: (owner: Address, intent: OrderIntent) => Promise<RiskPreview>;

  /** Builds an unsigned transaction for a confirmed intent. */
  prepareOrder: (owner: Address, intent: OrderIntent) => Promise<PreparedOrder>;

  /**
   * Independently decodes the prepared transaction and checks it against the
   * intent. Adapters must not reuse their builder's own output as evidence.
   */
  verifyPreparedOrder: (prepared: PreparedOrder) => Promise<VerificationResult>;

  submitSignedOrder: (
    prepared: PreparedOrder,
    signedTransaction: Uint8Array,
  ) => Promise<SubmissionResult>;

  subscribeOraclePrice: (
    market: MarketSymbol,
    onPrice: (price: OraclePrice) => void,
  ) => Unsubscribe;

  subscribePositions: (
    owner: Address,
    onPositions: (positions: readonly Position[]) => void,
  ) => Unsubscribe;
};
