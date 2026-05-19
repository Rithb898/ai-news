import OpenAI from "openai";

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export const MODEL = "gpt-5.4-mini";
