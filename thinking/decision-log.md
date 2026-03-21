# Decision Log

## Decision 1

The system should be organized around three edges:

- underlying edge
- volatility edge
- structure edge

Reason:

This is the cleanest way to prevent chart-driven overreach and to force premium pricing to be evaluated separately from direction.

## Decision 2

Point-in-time storage is mandatory.

Reason:

Without historical options-snapshot persistence, the system cannot support serious auditability, backtesting, or post-mortem review.

## Decision 3

GPT should summarize deterministic analytics, not replace them.

Reason:

A system that depends on GPT to infer premium richness directly from loosely structured chain data is not sufficiently reliable or reviewable.

## Decision 4

Fast-lane contracts should remain a separate recommendation class.

Reason:

Short-dated premium behaves differently enough that it should not be forced into the same ranking logic as standard swing-duration contracts.

## Decision 5

The product should explicitly support `no trade` outcomes.

Reason:

A high-quality internal research system must be able to reject apparently interesting setups when premium, liquidity, decay, or event structure do not justify the trade.

## Decision 6

The first implementation target should be premium diagnostics before complex multi-leg optimization.

Reason:

The current system lacks the full diagnostic substrate needed for credible premium mispricing analysis. Building spread optimizers before the volatility and history layer would be premature.
