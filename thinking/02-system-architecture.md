# System Architecture

## Design Goals

The system should satisfy the following design goals:

- separate deterministic analytics from narrative synthesis
- preserve point-in-time correctness
- allow historical backtesting and forward paper-trading
- expose enough intermediate state that analysts can audit recommendations
- prevent the UI from becoming the only place where analytics exist

## Architectural Layers

The proposed architecture has seven layers.

### 1. Data Source Layer

Purpose:

- fetch raw market, options, and event data from providers

Responsibilities:

- underlying bars
- options chain snapshots
- Greeks and implied vol, if available from provider
- corporate event calendars
- macro event calendars

Design requirement:

Each provider should be wrapped behind a stable internal interface. Vendor-specific response shapes should not leak into downstream logic.

Suggested modules:

- `src/lib/providers/market-data/*`
- `src/lib/providers/options-data/*`
- `src/lib/providers/events/*`

### 2. Normalization Layer

Purpose:

- transform provider responses into internal canonical types

Responsibilities:

- normalize symbols, expirations, strikes, option type, quote timestamps
- normalize Greeks naming and units
- normalize volume, open interest, spread, mark, implied vol
- add source and fetch timestamp metadata

Canonical entities:

- `UnderlyingBar`
- `OptionContractSnapshot`
- `OptionGreeksSnapshot`
- `OptionSurfacePoint`
- `CorporateEvent`
- `MacroEvent`

### 3. Persistence Layer

Purpose:

- retain point-in-time snapshots so the system can analyze history rather than only current state

This is essential.

Without persistence, you cannot answer:

- Was IV rank actually elevated when the trade idea was generated?
- Was the front-month skew steep at the time?
- Did the system repeatedly recommend contracts that looked cheap only because the live feed was incomplete?

Required stores:

- `underlying_bar_store`
- `option_chain_snapshot_store`
- `option_surface_snapshot_store`
- `event_store`
- `research_decision_store`
- `trade_outcome_store`

Retention design:

- underlying bars: durable historical time series
- options snapshots: frequent append-only snapshots keyed by symbol and expiration
- events: append and revise with source-version metadata
- decisions: immutable decision log with versioned model metadata

### 4. Feature and Analytics Layer

Purpose:

- compute objective inputs used to assess movement, volatility pricing, and structure quality

This layer should be entirely deterministic.

Subdomains:

- underlying technical features
- realized volatility features
- implied volatility features
- term-structure features
- skew features
- contract microstructure features
- event proximity features

Output examples:

- `UnderlyingFeatureSnapshot`
- `VolatilityFeatureSnapshot`
- `SurfaceFeatureSnapshot`
- `LiquidityFeatureSnapshot`
- `EventRiskSnapshot`

### 5. Scoring and Recommendation Layer

Purpose:

- combine deterministic features into rankable decisions

This layer should produce:

- `UnderlyingEdgeScore`
- `VolatilityEdgeScore`
- `StructureEdgeScore`
- `ContractScore`
- `SpreadScore`
- `NoTradeReason`

Important design rule:

This layer should generate both positive and negative reasons.

Example:

- positive: strong relative strength, low IV percentile, clean weekly chain
- negative: break-even too far, earnings in 2 days, front-term IV already rich

That makes the system auditable and more trustworthy.

### 6. Research Synthesis Layer

Purpose:

- turn structured analytics into human-readable research packets

This is where GPT belongs.

GPT inputs should be narrow, structured, and explicit:

- summary statistics
- reason codes
- regime labels
- contract candidates
- event flags

GPT outputs should be constrained to:

- summary
- bullish/bearish/neutral framing
- trade implementation view
- risks
- rejection reasons

GPT should not decide which contracts are cheap. The deterministic engine should decide that first.

### 7. Presentation Layer

Purpose:

- surface the analytics in a usable internal workflow

UI components:

- symbol screener
- detail chart and study panel
- volatility and surface panel
- contract table
- spread table
- event-risk panel
- decision explanation panel

## Recommended Internal Data Model

The following entity boundaries are important.

### `UnderlyingResearchSnapshot`

Contains:

- price and volume bars
- technical features
- relative strength features
- regime classification
- expected move estimates from underlying behavior

### `OptionSurfaceSnapshot`

Contains:

- symbol
- timestamp
- expiration buckets
- strike buckets
- ATM IV
- skew metrics
- term-structure metrics
- wing richness metrics

### `ContractResearchSnapshot`

Contains:

- contract identifier
- quote quality
- volume
- open interest
- mark
- implied vol
- Greeks
- expected move comparison
- break-even distance
- time-to-target compatibility
- contract score
- rejection reasons

### `TradeRecommendationPacket`

Contains:

- symbol
- recommendation timestamp
- underlying thesis
- vol thesis
- structure thesis
- chosen contract or spread
- explicit risk factors
- invalidation conditions

## Event Flow

The event flow should look like this:

1. Scheduler fetches underlying bars and options chain snapshots.
2. Raw responses are normalized.
3. Snapshots are persisted.
4. Feature jobs compute underlying and volatility analytics.
5. Scoring jobs rank symbols, contracts, and spreads.
6. UI queries the latest research snapshot.
7. GPT synthesis runs on top of the structured packet when requested.

## Storage Strategy

Short-term recommendation:

- keep current UI architecture
- add a local durable database or hosted relational store

Practical schema families:

- `symbols`
- `underlying_bars`
- `option_chain_snapshots`
- `option_quotes`
- `option_surface_metrics`
- `events`
- `research_snapshots`
- `recommendation_runs`
- `recommendation_reasons`
- `trade_outcomes`

## Why Point-in-Time Storage Matters

This system will be reviewed by serious operators. They will correctly ask:

- What did the model know at the time?
- What did the chain look like at the time?
- What did implied vol look like relative to history at the time?

If the system cannot answer those questions, it will not be credible.

## Boundary Between Deterministic Engine and GPT

Correct split:

- deterministic engine computes facts and scores
- GPT explains, prioritizes, and packages those facts

Incorrect split:

- GPT infers whether IV is rich or cheap from raw chain text alone

That second design is not reliable or reviewable enough.
