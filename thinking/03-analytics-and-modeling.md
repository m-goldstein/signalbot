# Analytics and Modeling Framework

## Overview

Mispriced premium detection requires more than a directional model. It requires a joint model of:

- underlying path
- volatility pricing
- contract friction
- time decay
- event risk

The analytics should therefore be organized into six engines.

## 1. Underlying Edge Engine

Purpose:

- estimate whether the underlying has a credible directional or volatility-expansion edge

Inputs:

- relative strength vs `SPY`, `QQQ`, and sector ETF
- multi-timeframe trend alignment
- momentum persistence
- breakout and breakdown pressure
- realized volatility regime
- participation quality
- support and resistance distance

Outputs:

- directional bias
- regime label
- expected path range
- expected time-to-target
- confidence score

Recommended regimes:

- trend continuation
- trend exhaustion
- range mean reversion
- volatility compression
- volatility expansion
- event-distorted

## 2. Realized Volatility Engine

Purpose:

- estimate what the underlying actually tends to do

Metrics:

- close-to-close realized vol
- Parkinson vol
- Garman-Klass vol
- Yang-Zhang vol
- ATR-based movement estimates
- gap contribution
- overnight vs intraday realized volatility

Why this matters:

If implied volatility is being compared to only one simplistic realized-vol estimate, the system can be badly misled.

Different realized-vol measures answer different questions.

Recommended outputs:

- `rv10`
- `rv20`
- `rv60`
- `rv90`
- `intraday_rv20`
- `overnight_rv20`
- `gap_frequency`
- `atr14_percent`

## 3. Implied Volatility and Surface Engine

Purpose:

- measure how the options market is pricing future distribution

Metrics:

- ATM IV by expiration
- IV rank
- IV percentile
- term structure slope
- front/back spread
- skew slope
- call wing richness
- put wing richness
- smile curvature

Derived judgments:

- front term rich
- front term cheap
- back term rich
- skew defensive
- upside speculation elevated
- event premium concentrated in nearest expiry

This engine should also maintain surface history so that "high IV rank" is not computed from a tiny sample.

## 4. Contract Friction and Liquidity Engine

Purpose:

- filter out theoretical edges that are not actually tradable

Metrics:

- quoted spread
- spread as % of premium
- volume
- open interest
- quote staleness
- mark reliability
- delta concentration
- depth, if provider supports it

Hard gates should exist.

If a contract fails liquidity thresholds, the system should not bury that inside a low score. It should explicitly mark it as rejected.

Suggested reason codes:

- `spread_too_wide`
- `open_interest_too_low`
- `volume_too_low`
- `quote_stale`
- `mark_unreliable`

## 5. Expected Move and Reachability Engine

Purpose:

- compare premium cost to plausible path of the underlying

This is one of the most important layers in the entire system.

Key questions:

- Is the break-even reachable?
- Is the strike reachable?
- Is the move reachable before theta becomes dominant?
- Is the implied move larger than the technically realistic target?

Metrics:

- break-even distance as % of spot
- strike distance as % of spot
- implied move to expiration
- ATR-implied movement by horizon
- realized-vol-implied movement by horizon
- target distance to resistance/support
- median historical days to move 1 ATR, 2 ATR, 3 ATR

This engine should produce:

- `breakeven_reach_score`
- `strike_reach_score`
- `time_to_target_score`
- `target_vs_implied_score`

## 6. Strategy Selection Engine

Purpose:

- determine the correct implementation, not just the attractive contract

The system should choose between:

- long call
- long put
- call spread
- put spread
- calendar
- diagonal
- no trade

Selection logic examples:

- strong underlying edge + cheap vol + sufficient path = long premium candidate
- strong underlying edge + rich vol = debit spread candidate
- weak directional edge + underpriced expansion = straddle/strangle research candidate
- decent chart + poor liquidity + near event = no trade

The engine should also decide whether a contract belongs in:

- normal candidates
- fast-lane candidates
- watchlist only
- reject

## Mispricing Score Framework

The system should not rely on a single scalar. Use a decomposed score.

Recommended top-level formula:

`mispricing_opportunity_score = f(underlying_edge, volatility_edge, structure_edge, friction_penalty, event_penalty)`

With decomposed sub-scores:

- `underlying_edge_score`
- `volatility_edge_score`
- `structure_edge_score`
- `liquidity_score`
- `decay_penalty`
- `event_penalty`
- `confidence_score`

### Suggested Components

#### `underlying_edge_score`

Inputs:

- relative strength
- trend alignment
- momentum
- participation
- regime
- target clarity

#### `volatility_edge_score`

Inputs:

- IV rank / percentile
- IV vs RV gap
- term structure distortion
- skew richness
- event premium distortion

#### `structure_edge_score`

Inputs:

- break-even reachability
- theta burden
- expiration suitability
- delta suitability
- spread width
- implementation fit

## Fast-Lane Logic

Fast-lane candidates should be treated as a separate class, not merely as short-DTE versions of normal candidates.

Fast-lane candidates should require:

- immediate setup alignment
- short time-to-target
- strong participation
- clear nearby technical level
- acceptable quote quality

Fast-lane scoring should emphasize:

- path immediacy
- same-session or same-week catalyst alignment
- gamma sensitivity
- theta hazard
- slippage tolerance

It should de-emphasize low premium as a primary criterion.

Cheap bad premium is still bad premium.

## GPT Role in This Architecture

Once deterministic analytics are computed, GPT can add value by:

- producing a concise research memo
- identifying contradictions between underlying and premium
- stating why a long premium trade is or is not justified
- comparing recommended structures
- surfacing the most important risk flags

Recommended prompt structure:

1. System instructions:
   - do not invent missing metrics
   - respect deterministic scores
   - explain contradictions explicitly

2. Structured input:
   - symbol
   - underlying regime
   - volatility regime
   - event flags
   - ranked contracts
   - rejection reasons

3. Required output:
   - thesis
   - premium assessment
   - structure recommendation
   - fast-lane suitability
   - risks
   - no-trade reasons, if applicable

## Backtesting and Learning Loop

To make the system progressively better, store every decision and later evaluate:

- realized move after 1 day, 3 days, 5 days, 10 days
- realized IV change after recommendation
- whether implied edge actually mean-reverted
- whether the recommended structure outperformed alternatives

That enables:

- threshold tuning
- regime-specific model tuning
- contract-scoring recalibration
- false-positive analysis

This learning loop is critical if the system is intended to become more than a visually appealing research dashboard.
