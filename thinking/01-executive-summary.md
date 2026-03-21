# Executive Summary

## Objective

Extend Wolfdesk from an underlying-centric research tool into an options-pricing research platform capable of identifying and exploiting mispriced premium.

The intended outcome is not simply "find bullish charts and buy calls." The intended outcome is:

- identify when implied option premium is cheap or rich relative to plausible future movement
- determine whether that mispricing is actionable after friction, decay, and event risk
- select a structure that expresses the edge with acceptable risk

## Problem Statement

Most internal research tools fail here because they conflate three distinct questions:

1. Is the underlying likely to move?
2. Is the option premium cheap or expensive relative to that likely movement?
3. Is this contract or structure the correct implementation of that view?

Those are not the same question.

A strong chart alone does not imply a good long-premium trade.

Examples:

- A stock can be technically attractive, but the front-month call premium may already fully price the move.
- A stock can be neutral directionally, while short-dated implied volatility is underpricing a likely expansion.
- A stock can have edge, but the correct trade may be a debit spread, calendar, or no trade rather than a naked long option.

## Core Design Principle

The system should compute and expose three independent edges:

- `underlying_edge`
- `volatility_edge`
- `structure_edge`

The platform should only elevate a trade candidate when at least two of those edges are favorable and the third is not actively contradictory.

## Strategic Design Choice

The system should be built as a layered research engine:

1. Market and options data ingestion
2. Historical normalization and persistence
3. Volatility analytics and contract analytics
4. Mispricing scoring engine
5. Strategy-selection engine
6. Research UI and GPT synthesis layer

The GPT layer should sit last, not first.

GPT should summarize and explain the results of deterministic analytics. It should not invent the analytics.

## Required Data Expansion

The current Wolfdesk system already has:

- historical underlying price data
- technical feature computation
- options chain snapshots
- contract suggestion logic

To identify mispriced premium properly, it still needs:

- options chain history
- implied volatility history
- historical term structure snapshots
- historical skew snapshots
- event calendar data
- post-trade tracking data

## Key Insight

"Cheap premium" is not a single scalar concept. It is the intersection of several questions:

- Is implied volatility low relative to recent and medium-term realized volatility?
- Is the break-even realistically reachable before expiration?
- Is the theta burn acceptable relative to expected time-to-target?
- Is the chain liquid enough to realize the theoretical edge?
- Is any apparent cheapness simply compensation for an upcoming catalyst or hidden tail risk?

If the system cannot answer those questions, it is not truly identifying mispriced premium. It is only identifying interesting underlyings.

## Recommended Product Shape

The target product should provide four outputs per symbol:

1. `Underlying View`
   - bullish, bearish, neutral
   - confidence
   - regime classification

2. `Volatility View`
   - implied cheap
   - implied fair
   - implied rich
   - confidence

3. `Structure View`
   - long call
   - call spread
   - long put
   - put spread
   - calendar
   - no trade

4. `Implementation View`
   - ranked contracts
   - ranked spreads
   - fast-lane candidates
   - explicit reason codes

## Review Standard

This system should be evaluated against a high bar:

- Can it explain why an option is mispriced?
- Can it explain why a seemingly attractive option is not actionable?
- Can it distinguish directional edge from volatility edge?
- Can it defend the chosen structure versus alternatives?
- Can it survive realistic friction?

If the answer to those questions is no, then the system is not yet mature enough for serious premium exploitation research.
