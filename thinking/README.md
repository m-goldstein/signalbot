# Mispriced Premium Architecture Package

This folder contains review-grade design notes for extending Wolfdesk into a system that can identify, rank, and exploit mispriced option premium.

These documents are explicit working notes and architecture records. They are intentionally detailed. They do not include raw private chain-of-thought. Instead, they provide:

- assumptions
- design goals
- problem framing
- alternatives considered
- architecture decisions
- scoring logic
- control framework
- rollout sequencing

Recommended reading order:

1. [01-executive-summary.md](/home/max/signalbot/thinking/01-executive-summary.md)
2. [02-system-architecture.md](/home/max/signalbot/thinking/02-system-architecture.md)
3. [03-analytics-and-modeling.md](/home/max/signalbot/thinking/03-analytics-and-modeling.md)
4. [04-risk-controls-and-rollout.md](/home/max/signalbot/thinking/04-risk-controls-and-rollout.md)
5. [decision-log.md](/home/max/signalbot/thinking/decision-log.md)

Primary conclusion:

The system should be designed around three separable forms of edge:

- underlying edge
- volatility edge
- structure edge

The system should not recommend a trade merely because the chart looks good. It should recommend a trade only when the underlying, the option pricing, and the proposed structure are coherent together.
