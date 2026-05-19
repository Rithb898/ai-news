import { config } from "../shared/config.ts";
import type { RssItem, Turn } from "../shared/types.ts";

export const SYSTEM_PROMPT = `You are the writer for a 24/7 AI news radio show, mid-broadcast. Two co-hosts:
- HOST_A (warm, curious, asks the framing questions)
- HOST_B (sharper, technical, fills in detail and context)

This is a CONTINUOUS LIVE radio show. Listeners have been hearing the show; you are writing the next segment, which flows seamlessly from whatever was just said. You are NOT starting a new show, episode, or topic block — you are continuing one already in progress.

Hard rules:
- Output a JSON object: { "turns": [ { "speaker": "HOST_A" | "HOST_B", "text": "..." } ] }
- Between ${config.turnRange.min} and ${config.turnRange.max} turns total.
- Speakers should alternate most of the time (an occasional two-turn run is fine).
- Combined word count across all "text" fields ~${config.segmentWordTarget} words (±20%).
- Conversational, spoken English. No stage directions, no markdown, no URLs, no emojis.
- Don't invent facts beyond the provided article; if details are thin, stay general.

Continuity rules (mandatory unless told otherwise in the user message):
- FORBIDDEN phrases (do not use anywhere): "welcome", "welcome back", "today's topic", "today we're", "in today's news", "in today's episode", "good morning", "good afternoon", "good evening", "tune in", "that's all for", "thanks for listening", "stay tuned", "stick around", "coming up after", "see you next", "until next time".
- OPEN with a natural mid-show transition: "Speaking of", "On a related note", "Switching gears", "Next up", "Moving on", "That reminds me", or a direct reaction to the prior turn. Do NOT greet the audience or each other.
- CLOSE by trailing off into the next topic — no sign-off, no summary takeaway framed as an ending, no "and that's the news". The last turn should sound like the conversation is about to continue.`;

export interface PromptContext {
  previousTail?: Turn[];
  coldOpen: boolean;
  strictReminder?: boolean;
}

export function userPromptForArticle(item: RssItem, ctx: PromptContext): string {
  const lines: string[] = [];

  if (ctx.coldOpen) {
    lines.push(
      "This is the START of the broadcast (fresh boot). A brief, natural welcome is allowed — but keep it short and roll directly into the topic. The forbidden-phrase list is relaxed for this segment only.",
      "",
    );
  } else if (ctx.previousTail && ctx.previousTail.length > 0) {
    lines.push("Previous segment ended with:");
    for (const t of ctx.previousTail) {
      lines.push(`  ${t.speaker}: "${t.text.replace(/"/g, '\\"')}"`);
    }
    const lastSpeaker = ctx.previousTail[ctx.previousTail.length - 1]!.speaker;
    const opener = lastSpeaker === "HOST_A" ? "HOST_B" : "HOST_A";
    lines.push(
      `Continue naturally from this. The opening host should be ${opener} (the other host from whoever just spoke).`,
      "",
    );
  } else {
    lines.push(
      "Continue the show mid-broadcast. Open with a transition, not a greeting.",
      "",
    );
  }

  lines.push(
    `Source: ${item.source}`,
    `Title: ${item.title}`,
  );
  if (item.summary) lines.push(`Summary: ${item.summary}`);
  lines.push("");

  if (ctx.strictReminder) {
    lines.push(
      "STRICT REMINDER: Your previous attempt used a forbidden greeting/sign-off phrase. Do NOT use any of: welcome, welcome back, today's topic, today we're, in today's news, good morning/afternoon/evening, tune in, that's all for, thanks for listening, stay tuned. Open with a mid-show transition; close by trailing into the next topic.",
      "",
    );
  }

  lines.push("Write the dialogue now as the JSON object specified.");
  return lines.join("\n");
}

export const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bwelcome\b/i,
  /\bwelcome back\b/i,
  /\btoday'?s topic\b/i,
  /\btoday we'?re\b/i,
  /\bin today'?s news\b/i,
  /\bin today'?s episode\b/i,
  /\bgood morning\b/i,
  /\bgood afternoon\b/i,
  /\bgood evening\b/i,
  /\btune in\b/i,
  /\bthat'?s all for\b/i,
  /\bthanks for listening\b/i,
  /\bstay tuned\b/i,
  /\bstick around\b/i,
  /\buntil next time\b/i,
  /\bsee you next\b/i,
];

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
