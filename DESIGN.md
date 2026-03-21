# DESIGN.md

## Purpose

This document defines the target architecture, methodology, and design principles for an AI-assisted trading research and execution system focused on technology, semiconductor, chip manufacturing, and adjacent equities.

The goal is to build a system that is:

- systematic,
- testable,
- explainable,
- realistic about options pricing and execution,
- robust across market regimes,
- useful for both research and live trading.

This file should guide AI agents and human contributors toward high-quality design and implementation decisions.

---

## Core architectural principle

Do **not** design the system as:

**technical analysis → pick call or put**

That approach tends to overfit quickly and often looks much better in research notebooks than in live trading.

Instead, the target architecture is:

**market scanner → signal engine → probabilistic forecast → options decision layer → portfolio/risk engine → execution layer → feedback/research loop**

This separation is essential because being directionally right on a stock is **not** the same as being right on an option.

Options add additional dimensions of risk and decision complexity, including:

- timing,
- implied volatility,
- decay,
- spread quality,
- liquidity,
- structure selection.

---

## Design questions the system must answer

The system should answer three questions, in order:

### 1. Is there a directional edge in the underlying?

Examples:

- breakout continuation,
- mean reversion at the 200DMA,
- retracement bounce,
- failed breakout,
- trend exhaustion reversal.

### 2. Is an option the right instrument to express that edge?

Sometimes the answer should be **no**.

Example:
A directional view may be correct, but if implied volatility is inflated, buying options may still be a poor trade.

### 3. Which options structure best matches the forecast distribution?

Possible outputs include:

- long call,
- long put,
- debit spread,
- credit spread,
- broken-wing structure,
- no trade.

Many weak strategies fail because they only solve question 1.

---

## Universe construction

Because this project targets technology, semiconductor, chip manufacturing, and related names, the trading universe should be structured in layers.

### Tier 1: Core liquid names

Large-cap semiconductor and adjacent infrastructure names with deep, liquid options markets.

These names are the best place to begin because:

- spreads are tighter,
- slippage is more manageable,
- options chains are more reliable,
- execution assumptions are more realistic.

### Tier 2: Secondary liquid names

Mid-cap names with decent options markets, but somewhat higher gap risk and less stable liquidity.

### Tier 3: Peripheral ecosystem

Broader ecosystem names, including:

- equipment suppliers,
- foundry-adjacent companies,
- memory names,
- networking silicon,
- fabless designers,
- EDA companies,
- materials,
- packaging,
- AI infrastructure.

### Required metadata per ticker

The scanner should maintain metadata for each symbol, including:

- sector and sub-industry,
- average daily dollar volume,
- options open interest by strike and expiry,
- typical spread quality,
- earnings dates,
- ex-dividend dates,
- beta to SOXX / QQQ / NVDA / SMH,
- regime sensitivity.

The goal is to screen for both **signal quality** and **tradability**.

---

## System architecture

The system should be decomposed into distinct modules.

---

## A. Data layer

The data layer is foundational. If the data is sloppy, every downstream component becomes unreliable.

### Required data

The system should support:

- OHLCV data for daily and intraday bars,
- options chain snapshots,
- implied volatility surface data,
- historical realized volatility,
- earnings and corporate action calendars,
- benchmark indices and sector ETFs,
- optional macro context such as rates, dollar strength, and semiconductor ETF flows.

### Storage requirements

The data layer should support:

- point-in-time backtesting,
- event-aligned analysis,
- regime segmentation,
- feature replay.

### Non-negotiable rule

Use **point-in-time clean data**.

Avoid:

- survivorship bias,
- leakage from revised data,
- using current sector membership to represent historical periods.

---

## B. Feature engine

The feature engine computes technical and market-structure features.

### Price structure features

Examples:

- breakout above N-day high,
- breakdown below N-day low,
- distance from 20/50/100/200 DMA,
- 200DMA slope,
- moving average stack alignment,
- ATR-normalized move size,
- range compression and expansion,
- gap behavior,
- volume expansion versus trailing average,
- closing location value,
- trend persistence.

### Fibonacci and retracement features

Fibonacci logic should be treated systematically, not mystically.

Define:

- recent swing high and swing low using objective pivot logic,
- retracement depth as a fraction of the impulse leg,
- confluence with prior support or resistance,
- retracement speed,
- reaction quality at the level,
- whether retracement occurs in a trend or countertrend regime.

Treat Fibonacci levels as **candidate structure features**, not as standalone truths.

### Breakout quality features

The system should distinguish between different kinds of breakouts, for example:

- clean base breakout with expanding volume,
- breakout after an already extended move,
- exhaustion-style breakout,
- false breakout or failed auction,
- breakout into major overhead supply.

Useful breakout-quality features include:

- base length,
- base tightness,
- volume dry-up before the move,
- breakout candle body-to-range ratio,
- follow-through over the next 1 to 3 bars,
- distance to next resistance,
- relative strength versus sector ETF.

### Regime features

Many technical systems improve dramatically when conditioned on regime.

Examples:

- underlying above or below a rising 200DMA,
- sector ETF trend state,
- VIX / VVIX regime,
- realized volatility percentile,
- implied volatility percentile,
- earnings proximity,
- market breadth condition,
- correlation-shock regime.

A setup that works in a calm trending environment may fail badly in a high-volatility rotational market.

---

## C. Signal engine

The signal engine should convert raw features into a small number of named setup classes.

### Example setup classes

- trend breakout continuation,
- pullback to 200DMA bounce,
- failed breakout short,
- Fibonacci retracement continuation,
- mean reversion from overextension,
- post-gap continuation,
- trend exhaustion reversal.

### Each setup class should define

- entry conditions,
- invalidation conditions,
- target logic,
- expected holding period,
- confidence score,
- regime filters.

This is preferable to one giant monolithic score because it allows each setup family to be studied, validated, and improved independently.

---

## D. Probabilistic forecast engine

This is the system’s central intelligence layer.

The objective is **not** to output simple labels like “bullish” or “bearish.”

Instead, the system should forecast distributions such as:

- probability of an up move over horizon H,
- probability of a down move over horizon H,
- expected move magnitude,
- probability of target-before-stop,
- expected time to target,
- probability of a gap event,
- terminal price distribution.

### Example forecast output

For a given ticker over the next 10 trading days:

- 58% chance the stock closes higher,
- 31% chance it hits target T before stop S,
- median expected move of +3.4%,
- 90th percentile upside of +8.1%,
- downside tail of -5.7%.

This distribution is what the options layer needs.

### Recommended modeling approach

A strong design is a hybrid of:

- rules-based setup detection,
- plus a statistical meta-model to calibrate expectancy.

### Example targets

- forward return over 3 / 5 / 10 / 20 days,
- target-before-stop event,
- exceed break-even move by expiry,
- realized volatility over holding window,
- implied-vs-realized volatility spread outcome.

### Reasonable model classes

Conceptually appropriate models include:

- logistic models for directional probability,
- gradient boosted trees for nonlinear feature interaction,
- survival or hazard models for time-to-level,
- quantile models for move distribution,
- HMMs or regime classifiers for market state.

Deep learning is not required for the first version and is unlikely to be the initial source of edge.

---

## E. Options decision layer

This layer determines whether an options trade is justified and how it should be structured.

### Questions this layer must answer

- Buy call, buy put, use a vertical, or pass?
- Which expiry?
- Which strike or delta?
- Is implied volatility too expensive?
- Is theta too punitive relative to expected timing?
- Is the bid/ask spread too wide?

### Inputs to this layer

- forecast distribution,
- expected holding period,
- IV rank or percentile,
- skew and term structure,
- options liquidity,
- event risk,
- slippage estimate.

### Core principle

Map the **forecast shape** to the **option structure**.

Examples:

- strong directional edge, fast expected move, IV not elevated  
  → long call or long put may make sense

- moderate directional edge, capped expected move  
  → debit spread may be better than naked long premium

- high IV, directional edge present, move likely but not explosive  
  → verticals may be preferable to long premium

- edge too weak to overcome decay and spread  
  → no trade

### Option selection heuristics

For long premium, key considerations include:

- delta,
- gamma,
- theta,
- vega,
- time to expiry,
- break-even distance,
- bid/ask width,
- open interest.

### Initial practical guidelines

- for near-term swing trades, use expiries far enough out that theta is tolerable,
- avoid expiries so far out that time value is excessively expensive,
- avoid ultra-short-dated options unless the strategy is explicitly event-driven,
- prefer strikes with acceptable liquidity and spread quality,
- normalize decisions by expected move relative to option break-even.

### Internal decision metric

A useful internal metric is:

**Expected edge = forecasted option value under simulated price/IV paths − entry cost − slippage**

This is far more useful than simply saying “bullish, therefore buy a call.”

---

## F. Portfolio and risk engine

This layer is mandatory.

The project is not merely a predictor. It is a trading system.

### The portfolio engine should control

- number of positions,
- maximum exposure per ticker,
- maximum exposure per correlated cluster,
- maximum vega / gamma / theta,
- maximum earnings-event exposure,
- maximum daily loss,
- stop-trading rules after drawdown.

### Risk rules worth enforcing

- no oversized concentration in highly correlated names,
- cap exposure to a single narrative cluster,
- enforce liquidity filters on options spreads,
- reject trades when spread exceeds threshold relative to premium,
- avoid new long-premium entries close to earnings unless strategy is event-specific,
- do not average down unless explicitly designed,
- use volatility-adjusted sizing.

### Position sizing inputs

Sizing should depend on:

- forecast confidence,
- expected edge,
- option liquidity,
- portfolio correlation,
- drawdown state.

Fractional Kelly-inspired logic can be explored later, but the initial system should be conservative and use capped risk budgets.

---

## G. Execution engine

A good model can still fail because of poor execution.

### The execution layer should handle

- entry order selection,
- mid-price anchoring,
- adaptive price improvement,
- avoiding illiquid times,
- spread-aware order staging,
- exits based on:
  - target,
  - time stop,
  - invalidation,
  - volatility shift.

### Execution rules for options

- never assume midpoint fills in backtests unless justified,
- model slippage as a function of spread, open interest, premium, and urgency,
- account for partial fills,
- account for legging risk in multi-leg structures.

---

## H. Research and evaluation layer

This is where strategy quality is actually determined.

### The system should evaluate four levels

#### 1. Signal validity
Does the setup have predictive value in the underlying?

#### 2. Tradability
Does that predictive value survive slippage, IV, and decay in options?

#### 3. Stability
Does it work across:

- different names,
- different market regimes,
- different volatility regimes,
- different time periods?

#### 4. Capacity
Can it be scaled without fill quality collapsing?

---

## Methodology with the best chance of success

### Step 1: Start with a small number of setup families

Do **not** begin with 30 indicators.

Start with 3 to 5 well-defined setup families, such as:

- breakout continuation,
- pullback in established uptrend,
- failed breakout reversal,
- mean reversion from 200DMA extension,
- Fibonacci retracement continuation with trend filter.

Each family should be objectively defined.

### Step 2: Measure underlying outcomes first

Before touching options, answer:

- What is the forward return distribution after this setup?
- How does that vary by regime?
- What is hit rate versus payoff ratio?
- How long do winning moves usually take?

If the underlying edge is weak, options will not save it.

### Step 3: Condition on regime

Almost every technical setup is regime-dependent.

Example:

A breakout with:

- rising 200DMA,
- strong relative strength,
- sector trend confirmation

may behave very differently from a breakout with:

- flat or declining 200DMA,
- weak sector context.

These interactions should either be modeled or encoded explicitly.

### Step 4: Convert setups into price-path forecasts

The forecast should estimate:

- likely magnitude,
- likely timing,
- tail risk.

This is the bridge between directional signal and options selection.

### Step 5: Evaluate option expressions directly

For each setup instance, simulate candidate trades such as:

- ATM call,
- 25-delta call,
- call debit spread,
- ATM put,
- 25-delta put,
- put debit spread,
- no trade.

Then compare realized outcomes net of slippage and commissions.

Often the best options expression is not the most obvious one.

### Step 6: Build a meta-labeling layer

A powerful design is:

- base model finds setups,
- meta-model decides whether to take the trade.

Useful meta-features include:

- IV percentile,
- sector alignment,
- liquidity quality,
- breadth context,
- market regime,
- recent false signal frequency,
- event proximity.

This often improves precision significantly.

### Step 7: Optimize for robustness, not best backtest

Prioritize:

- cross-validation by time blocks,
- walk-forward testing,
- out-of-sample regime tests,
- stress-period analysis,
- parameter stability.

Avoid chasing “best” parameter sets. Prefer stable regions over fragile optima.

---

## Technical indicator philosophy

### Breakouts

Breakouts are useful, but their quality must be defined objectively.

They tend to work best when paired with:

- trend context,
- volume confirmation,
- prior compression,
- room to next resistance,
- sector confirmation.

### Fibonacci

Fibonacci is best treated as a structure feature, not a standalone trigger.

Retracements become more meaningful when combined with:

- strong prior impulse,
- trend alignment,
- support confluence,
- reaction quality,
- low countertrend volatility.

### 200DMA

The 200DMA is highly useful, especially as a regime filter.

Examples:

- above a rising 200DMA is very different from below a falling 200DMA,
- distance from the 200DMA can measure stretch and mean-reversion risk,
- recapture or rejection around the 200DMA can be a major event.

### Other methods worth including

Beyond the core methods, consider:

- relative strength vs SOXX / SMH / QQQ,
- volatility contraction patterns,
- anchored VWAP from major highs, lows, and gaps,
- gap continuation vs gap fade behavior,
- volume profile / high-volume nodes,
- trend slope and curvature,
- realized volatility compression,
- breadth and participation across the semiconductor basket.

---

## Where real edge usually comes from

In practice, edge usually does **not** come from the indicator itself.

It tends to come from:

- strong universe selection,
- regime filtering,
- conditioning on liquidity and event risk,
- rejecting marginal setups,
- matching forecast horizon to option expiry,
- disciplined sizing,
- realistic slippage modeling,
- knowing when **not** to buy premium.

That last point matters greatly.

Many systems can identify mildly bullish situations.
Far fewer can determine whether a specific call option at a specific strike, expiry, and IV level has positive expectancy.

---

## Practical scoring framework

A useful internal scoring system can evaluate each candidate along five axes.

### A. Directional conviction
How strong is the bullish or bearish signal?

### B. Timing clarity
Is the expected move likely within 3 days, 10 days, or 30 days?

### C. Magnitude sufficiency
Is the expected move large enough to overcome break-even and theta?

### D. Volatility attractiveness
Is the option fairly priced relative to forecasted realized movement?

### E. Execution quality
Are spreads and liquidity acceptable?

Only candidates that clear thresholds across all five axes should become trades.

---

## Strong initial architecture for v1

### Research stack

- historical market and options data store,
- feature computation pipeline,
- signal labeling framework,
- backtest engine with realistic fill assumptions,
- model training and validation module,
- reporting and analytics dashboard.

### Production stack

- universe scanner,
- daily and intraday feature refresh,
- signal classifier,
- forecast engine,
- option selector,
- risk engine,
- execution engine,
- monitoring and alerting,
- trade journal and attribution recorder.

### Observability requirements

Track at minimum:

- why a trade was entered,
- which setup family triggered it,
- model confidence,
- IV state,
- expected versus realized move,
- PnL attribution by:
  - signal family,
  - regime,
  - expiry bucket,
  - delta bucket,
  - ticker cluster.

This attribution loop is how the system improves over time.

---

## Biggest mistakes to avoid

### 1. Confusing chart pattern recognition with tradable edge

A visually appealing setup is not sufficient.

### 2. Ignoring option pricing

Being directionally right can still lose money due to theta decay or IV crush.

### 3. Using too many overlapping indicators

This often creates false confidence, not independent evidence.

### 4. Backtesting with unrealistic fills

This can make poor strategies look good.

### 5. Not separating underlying edge from options-expression edge

This is a critical design mistake.

### 6. Ignoring correlation clustering

Semiconductor names often move together.

### 7. Not handling earnings and event regimes separately

Pre-earnings and post-earnings behavior are materially different.

### 8. Overfitting thresholds

Examples like:

- 21-day breakout,
- 1.7x volume,
- 0.618 retracement,
- 43 DTE

can easily create fragile, overfit logic.

---

## What a high-quality methodology looks like

A strong methodology should:

1. build a clean, liquid universe,
2. define a small number of objective setup families,
3. engineer technical, volatility, and regime features,
4. estimate conditional price-path distributions instead of binary direction only,
5. evaluate whether options are the correct vehicle,
6. select strikes and expiries based on expected move, timing, and IV,
7. apply portfolio-level risk and correlation controls,
8. use realistic backtests and walk-forward validation,
9. measure performance by setup family and regime,
10. continuously prune weak setups and retain only stable ones.

---

## Recommended first version

The first serious version should **not** attempt to cover every possible technical strategy.

Focus on a small number of high-value setup families:

- bullish breakout continuation,
- bearish failed breakout,
- pullback continuation in a strong trend,
- mean reversion from extreme 200DMA stretch.

Initial trade evaluation should focus on:

- underlying forecast edge,
- then comparing:
  - long option,
  - debit spread,
  - no trade.

This is enough to create a strong first-generation framework without drowning in complexity.

---

## Key philosophical shift

The correct framing is **not**:

> Find indicators that predict bullish or bearish.

The correct framing is:

> Estimate the conditional distribution of future price movement for a liquid underlying, then choose the best options expression only when the expected edge survives volatility, decay, and execution costs.

That is the core design philosophy of this project.
