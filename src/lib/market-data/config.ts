const DEFAULT_ALPACA_DATA_BASE_URL = "https://data.alpaca.markets";

export function getAlpacaConfig() {
  return {
    dataBaseUrl:
      process.env.ALPACA_DATA_BASE_URL?.trim() || DEFAULT_ALPACA_DATA_BASE_URL,
    apiKey: process.env.ALPACA_API_KEY?.trim() || process.env.APCA_API_KEY_ID?.trim() || "",
    apiSecret:
      process.env.ALPACA_API_SECRET?.trim() ||
      process.env.APCA_API_SECRET_KEY?.trim() ||
      "",
  };
}

export function hasAlpacaCredentials() {
  const config = getAlpacaConfig();
  return Boolean(config.apiKey && config.apiSecret);
}
