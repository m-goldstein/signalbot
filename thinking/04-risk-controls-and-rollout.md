# Risk Controls and Rollout Plan

## Primary Failure Modes

If implemented poorly, a mispriced-premium system will fail in predictable ways.

### Failure Mode 1: Confusing directional edge with premium edge

Example:

- stock is bullish
- call premium is already very expensive
- system still recommends long calls

Mitigation:

- require explicit volatility-edge computation
- surface `rich premium` as a first-class output

### Failure Mode 2: Ignoring chain friction

Example:

- contract looks theoretically cheap
- spread is too wide
- slippage consumes the edge

Mitigation:

- hard liquidity gates
- explicit slippage penalties
- separate "research interesting" from "tradeable"

### Failure Mode 3: Event blindness

Example:

- option looks cheap versus trailing realized vol
- earnings are tomorrow
- premium is not actually cheap; it is event-loaded

Mitigation:

- corporate and macro event proximity features
- event-distorted regime label
- mandatory event warnings in recommendation output

### Failure Mode 4: Incorrect time-horizon matching

Example:

- expected move is plausible over 20 trading days
- recommended contract expires in 4 trading days

Mitigation:

- time-to-target engine
- expiration suitability scoring
- fast-lane and normal-candidate separation

### Failure Mode 5: Overconfidence from incomplete data

Example:

- feed misses part of the chain
- system treats missing contracts as absent opportunity

Mitigation:

- data completeness checks
- freshness checks
- snapshot quality flags
- explicit degraded-data status in UI

## Required Control Framework

The system should distinguish:

- `eligible`
- `interesting but blocked`
- `rejected`

That distinction matters.

A contract may be analytically attractive but operationally blocked due to liquidity or event risk. The system should say that clearly.

## Recommendation Guardrails

Every recommendation should include:

- timestamp
- input data timestamps
- provider source
- event flags
- rejection reasons for alternatives
- invalidation criteria

Recommended guardrail fields:

- `data_freshness_ok`
- `chain_completeness_ok`
- `liquidity_ok`
- `event_risk_acknowledged`
- `expiration_fit_ok`
- `premium_edge_ok`

## Suggested Phased Rollout

### Phase 1: Deterministic Premium Diagnostics

Goal:

- explain whether premium is cheap or rich before recommending new structures

Deliverables:

- IV rank / percentile
- IV vs RV comparisons
- term structure slope
- skew metrics
- break-even reachability metrics
- event flags
- contract reason codes

Success criterion:

- analysts can explain why a contract is being accepted or rejected without using GPT

### Phase 2: Structure Recommendation Engine

Goal:

- move from contract ranking to structure ranking

Deliverables:

- long premium versus debit spread logic
- calendar logic for event distortions
- fast-lane versus standard-candidate separation
- no-trade determination logic

Success criterion:

- recommended structure changes appropriately when vol is rich versus cheap

### Phase 3: Historical Persistence and Evaluation

Goal:

- make the system auditable and learnable

Deliverables:

- options chain history store
- surface history store
- recommendation logs
- post-trade outcome analysis

Success criterion:

- every recommendation can be reconstructed point-in-time

### Phase 4: GPT Synthesis on Top of Deterministic Engine

Goal:

- improve communication quality, not analytical correctness

Deliverables:

- structured GPT research packets
- explanation and contradiction analysis
- ranked implementation summary

Success criterion:

- GPT output is consistent with deterministic engine and never substitutes for it

## Suggested UI Extensions

To make the analytics usable, the symbol detail view should eventually include:

- implied volatility term structure chart
- realized versus implied comparison panel
- skew panel
- expiration table with expected move and IV rank
- contract table with rejection reason chips
- spread candidates table
- event-risk panel
- decision memo panel

## Non-Negotiable Standards

For a system that may influence real risk-taking, the following should be non-negotiable:

- point-in-time correctness
- explicit data quality checks
- deterministic scoring before GPT synthesis
- clear no-trade outcomes
- auditable rejection reasons
- separation between research output and execution

## Final Recommendation

The next highest-value move is not additional visual polish. It is building the options-volatility data and diagnostics layer so the system can answer:

- Is premium cheap or rich?
- Relative to what?
- Over what horizon?
- After what friction?
- In which structure?

Until that layer exists, the system remains strong at finding interesting underlyings but incomplete at exploiting true premium mispricing.
