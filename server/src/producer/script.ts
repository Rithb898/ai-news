import { config } from "../shared/config.ts";
import type { Dialogue, RssItem, Turn } from "../shared/types.ts";
import { MODEL, openai } from "./openai.ts";
import {
  DIALOGUE_SCHEMA,
  FORBIDDEN_PATTERNS,
  SYSTEM_PROMPT,
  userPromptForArticle,
  type PromptContext,
} from "./prompts.ts";

export class ScriptValidationError extends Error {}

function wordCount(turns: Turn[]): number {
  return turns.reduce(
    (n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
}

export function validateDialogue(d: Dialogue): void {
  const { turns } = d;
  const { min, max } = config.turnRange;
  if (!Array.isArray(turns) || turns.length < min || turns.length > max) {
    throw new ScriptValidationError(
      `turn count ${turns?.length} outside [${min},${max}]`,
    );
  }
  for (const t of turns) {
    if (t.speaker !== "HOST_A" && t.speaker !== "HOST_B") {
      throw new ScriptValidationError(`bad speaker: ${t.speaker}`);
    }
    if (!t.text?.trim()) throw new ScriptValidationError("empty turn");
  }

  // alternating-ish: at most one run of length 2, no run of length >=3
  let run = 1;
  for (let i = 1; i < turns.length; i++) {
    run = turns[i]!.speaker === turns[i - 1]!.speaker ? run + 1 : 1;
    if (run >= 3) {
      throw new ScriptValidationError("3+ consecutive turns by same speaker");
    }
  }

  const wc = wordCount(turns);
  const target = config.segmentWordTarget;
  if (wc < target * 0.6 || wc > target * 1.5) {
    throw new ScriptValidationError(
      `word count ${wc} far from target ${target}`,
    );
  }
}

export function findForbidden(turns: Turn[]): string | null {
  for (const t of turns) {
    for (const re of FORBIDDEN_PATTERNS) {
      const m = t.text.match(re);
      if (m) return m[0];
    }
  }
  return null;
}

async function callModel(item: RssItem, ctx: PromptContext): Promise<Dialogue> {
  const client = openai();
  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPromptForArticle(item, ctx) },
    ],
    response_format: { type: "json_schema", json_schema: DIALOGUE_SCHEMA },
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error("empty completion");

  let parsed: Dialogue;
  try {
    parsed = JSON.parse(raw) as Dialogue;
  } catch (e) {
    throw new Error(`json parse: ${(e as Error).message}\n${raw}`);
  }
  validateDialogue(parsed);
  return parsed;
}

export async function generateDialogue(
  item: RssItem,
  ctx: PromptContext = { coldOpen: false },
): Promise<Dialogue> {
  let dialogue = await callModel(item, ctx);

  if (!ctx.coldOpen) {
    let attempts = 0;
    while (attempts < 2) {
      const hit = findForbidden(dialogue.turns);
      if (!hit) break;
      attempts++;
      console.error(
        `[script] forbidden phrase "${hit}" detected; retry ${attempts}/2`,
      );
      dialogue = await callModel(item, { ...ctx, strictReminder: true });
    }
  }
  return dialogue;
}
