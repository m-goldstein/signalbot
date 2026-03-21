export function getOpenAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
  };
}

export function hasOpenAIConfig() {
  return Boolean(getOpenAIConfig().apiKey);
}
