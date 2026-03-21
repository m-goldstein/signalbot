# signalbot

A Next.js trading research foundation for scanning liquid semiconductor and adjacent equities, normalizing market data, and preparing for later signal and options-decision layers.

## Why Alpaca first

This project starts with Alpaca instead of Yahoo Finance because the repo goals prioritize correctness, maintainability, and a credible path from research workflows to production-grade integrations. The initial data layer uses an authenticated provider boundary so vendor-specific response shapes do not leak into the rest of the application.

## Current scope

- Next.js App Router web application in `src/`
- Alpaca-backed market-data provider abstraction in `src/lib/market-data/`
- Curated semiconductor and adjacent universe module in `src/lib/universe/`
- Pure feature engine for trend, price structure, and volatility metrics in `src/lib/features/`
- `GET /api/market/bars` endpoint for normalized OHLCV bar retrieval
- `GET /api/screener` endpoint for ranked research rows across the curated universe
- `GET /api/openinsider` endpoint that scrapes OpenInsider, normalizes insider rows, and aggregates ticker/date summaries
- `GET /api/openinsider/analyze` endpoint that runs GPT analysis over the top insider tickers from the current OpenInsider query
- Starter dashboard page for symbol and timeframe inspection
- `/screener` page for filtering and sorting the research universe

## Getting started

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file and fill in your Alpaca credentials:

```bash
cp .env.example .env.local
```

3. Start the development server:

```bash
npm run dev
```

4. Open `http://localhost:3000`

## Environment variables

- `ALPACA_API_KEY`: Alpaca API key
- `ALPACA_API_SECRET`: Alpaca API secret
- `ALPACA_DATA_BASE_URL`: Optional override, defaults to `https://data.alpaca.markets`
- `OPENAI_API_KEY`: OpenAI API key for insider analysis
- `OPENAI_MODEL`: Optional OpenAI model override, defaults to `gpt-5-mini`

The API route also accepts the legacy Alpaca variable names `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`.
