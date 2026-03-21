# Wolfdesk


Wolfdesk is an internal trading research application built with Next.js. It combines:

- an Alpaca-backed market screener
- inline chart and setup inspection
- options contract ranking and watchlisting
- OpenInsider scraping and aggregation
- GPT-assisted analysis for both screener selections and insider activity

This is not a public-facing product. The UI and workflows are optimized for internal research use.

## Current modules

### Screener

The screener is the primary module and the default home view after login.

It currently supports:

- curated multi-section stock universe
  - tech stocks
  - defense contractors
  - market leaders and benchmarks
  - selected rows working set
- sortable grouped columns
- per-table search
- dork-style filters such as `price<100, atr<4, conv>60`
- user-controlled history start date
- inline expandable detail rows
- chart overlays and time-slice controls
- Fibonacci overlays and analysis
- GPT analysis on explicitly selected rows only
- suggested options contracts and fast-lane contracts
- contract watchlist in the top navbar

### OpenInsider

The OpenInsider module is the secondary research module.

It currently supports:

- scraping the OpenInsider table
- buy/sell filtering
- ticker / insider / relationship aggregation
- accumulation and distribution scoring
- research brief generation
- GPT analysis of top insider-activity symbols

## Authentication

The app is currently gated with a hardcoded login.

- username: `wolfdesk`
- password: `0dte`

This is intentionally temporary and should be replaced with real credential handling before broader deployment.

## Environment

Required environment variables:

- `ALPACA_API_KEY`
- `ALPACA_API_SECRET`
- `OPENAI_API_KEY`

Optional:

- `ALPACA_DATA_BASE_URL`
  - defaults to `https://data.alpaca.markets`
- `OPENAI_MODEL`
  - defaults to `gpt-5-mini`

Legacy Alpaca variable names are also accepted:

- `APCA_API_KEY_ID`
- `APCA_API_SECRET_KEY`

Example:

```bash
cp .env.example .env.local
```

## Local development

Install and run:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Screener usage

### Basic workflow

1. Log in.
2. Stay on the home page or go to `/screener`.
3. Set:
   - tier
   - sort field
   - sort direction
   - history start date
4. Review rows in the screener tables.
5. Check one or more rows.
6. Click `Run GPT analysis on N selected`.
7. Click a row to expand its detail view inline under that row.

### Inline row expansion

Clicking a row expands the chart, contract suggestions, and setup analysis directly below that row instead of moving the detail view to a detached panel. This is intended to make the table readable in sequence.

Clicking the same expanded row again collapses it.

### History start

The history window is controlled by a calendar input.

- default: 24 months of history
- validated server-side
- invalid dates are rejected
- future dates are rejected
- very recent dates are rejected so the feature engine still has enough bars

### Search and dorks

Each screener table has its own search field.

Plain text tokens match:

- symbol
- company name
- section
- segment

Numeric dorks use:

```text
field operator value
```

Supported operators:

- `<`
- `<=`
- `=`
- `>=`
- `>`

Supported numeric fields:

- `price`
- `atr`
- `adv20`
- `conv`
- `premium`
- `day`
- `1m`
- `3m`
- `6m`
- `1y`

Tokens are:

- comma-separated
- whitespace-normalized
- combined with AND logic

Examples:

```text
nvda
price<100, atr<4
semis, conv>60, premium>40
1m>5, 3m>10, adv20>100000000
```

### Sorting

You can sort by:

- using the sort dropdown at the top
- clicking grouped table headers to toggle ascending or descending order

### GPT analysis behavior

GPT screener analysis only runs on explicitly selected rows.

- no top-N fallback exists anymore
- the button is disabled until at least one row is selected
- analysis is cached in browser local storage for the current trading day
- cached results are restored when the current screener query and selection match

### Timed refresh

The screener auto-refreshes every 15 seconds during regular trading hours on trading days.

Current behavior:

- active only during market session windows
- preserves selected rows
- preserves inline expansion state when possible
- refreshes the expanded symbol detail if it is still relevant

Market-session detection is weekday-based and time-based. It does not currently include holiday-calendar logic.

### Detail view

Expanding a row shows:

- price graph
- volume graph
- time-slice controls
  - `1D`
  - `1W`
  - `1M`
  - `3M`
  - `6M`
  - `1Y`
  - `5Y`
  - `All time`
- overlay toggles
  - close
  - SMA 20
  - SMA 50
  - SMA 200
  - visible range
  - expected move
  - Fibonacci
  - volume

Below the graphs:

- suggested option contracts
- fast-lane contracts
- setup analysis

### Suggested options contracts

The options section uses live Alpaca option-chain snapshots and ranks contracts based on:

- setup alignment
- break-even plausibility versus technical targets
- time-to-target versus days to expiration
- spread quality
- activity and tradability proxies

It does not yet include:

- full IV rank / percentile
- full term-structure analysis
- open interest
- option-chain event modeling

### Fast-lane contracts

Fast-lane contracts are a separate aggressive bucket for short-dated opportunities, including same-day or end-of-week contracts when the setup, timing window, and quote quality justify them.

### Watchlist

The top navbar includes a `Watchlist` button.

From the options cards you can add or remove contracts from the watchlist. The popup shows:

- underlying
- contract symbol
- lane
- structure
- mark
- break-even
- DTE
- score

The watchlist is stored in browser local storage.

## OpenInsider usage

Go to `/openinsider` from the navbar.

### Basic workflow

1. Set:
   - symbol
   - side
   - row count
2. Refresh the scraper data.
3. Optionally set GPT top N.
4. Run GPT analysis.
5. Review:
   - ticker summaries
   - insider summaries
   - role summaries
   - ticker research briefs
   - GPT interpretation

### GPT persistence

OpenInsider GPT results are also cached in browser local storage for the active trading day and restored when the query matches.

### Timed refresh

OpenInsider data also refreshes every 15 seconds during trading hours on trading days.

The raw scraper dataset refreshes; GPT analysis is restored from cache when available for the current query.

## Data and safety notes

### Browser storage

GPT analysis responses are cached in browser local storage for the active trading day.

Current cache behavior:

- query-scoped
- trading-day-scoped
- validated before use
- sanitized before being restored into UI state

### Sanitization

Cached GPT responses are validated and sanitized before display:

- unexpected shapes are rejected
- enums are checked
- numeric fields are clamped to sane ranges
- text fields have angle brackets removed
- control characters are stripped

The UI renders these values as plain React text, not injected HTML.

## API routes

Current routes:

- `GET /api/market/bars`
- `GET /api/screener`
- `GET /api/screener/detail`
- `GET /api/screener/analyze`
- `GET /api/openinsider`
- `GET /api/openinsider/analyze`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## Known limitations

- market-session timing is based on weekdays and clock time, not exchange holiday calendars
- options ranking uses chain snapshots, not full chain analytics
- hardcoded auth is temporary
- OpenInsider source behavior can still be inconsistent, so server-side filtering remains necessary

## Verification

Current repository build check:

```bash
npm run build
```
