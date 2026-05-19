import { config } from "../shared/config.ts";
import type { RssItem } from "../shared/types.ts";

export const SYSTEM_PROMPT = `You are the writer for a 24/7 AI news radio show with two co-hosts:
- HOST_A (warm, curious, asks the framing questions)
- HOST_B (sharper, technical, fills in detail and context)

Write a short podcast-style dialogue covering ONE news item.

Hard rules:
- Output a JSON object: { "turns": [ { "speaker": "HOST_A" | "HOST_B", "text": "..." } ] }
- Between ${config.turnRange.min} and ${config.turnRange.max} turns total.
- Speakers should alternate most of the time (an occasional two-turn run is fine).
- Combined word count across all "text" fields ~${config.segmentWordTarget} words (±20%).
- Conversational, spoken English. No stage directions, no markdown, no URLs, no emojis.
- Open by naming the topic naturally; close with a brief takeaway. No "welcome back" or "tune in next time".
- Don't invent facts beyond the provided article; if details are thin, stay general.`;

export function userPromptForArticle(item: RssItem): string {
  return [
    `Source: ${item.source}`,
    `Title: ${item.title}`,
    item.summary ? `Summary: ${item.summary}` : "",
    "",
    "Write the dialogue now as the JSON object specified.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const DIALOGUE_SCHEMA = {
  name: "dialogue",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      turns: {
        type: "array",
        minItems: config.turnRange.min,
        maxItems: config.turnRange.max,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            speaker: { type: "string", enum: ["HOST_A", "HOST_B"] },
            text: { type: "string", minLength: 1 },
          },
          required: ["speaker", "text"],
        },
      },
    },
    required: ["turns"],
  },
  strict: true,
} as const;
