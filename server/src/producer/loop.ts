import { config } from "../shared/config.ts";
import { readState, writeState } from "../shared/state.ts";
import type { State } from "../shared/types.ts";
import { bufferedSecondsAhead, garbageCollect } from "./buffer.ts";
import { fingerprint } from "./dedup.ts";
import { pickNextArticle } from "./pick.ts";
import { retainFingerprints } from "./fingerprints.ts";
import { withRetry } from "./retry.ts";
import { generateDialogue } from "./script.ts";
import { ensureDirs, writeSegment } from "./segment.ts";
import { renderTurns } from "./tts.ts";

const TARGET_BUFFER_SEC = config.targetBufferMinutes * 60;
const IDLE_SLEEP_MS = 30_000;
const COLD_OPEN_GAP_MS = 10 * 60 * 1000;

async function generateOne(state: State): Promise<State> {
  const item = await pickNextArticle(state);
  console.error(`[loop] picked: [${item.source}] ${item.title}`);

  const lastAt = state.lastGeneratedAt
    ? Date.parse(state.lastGeneratedAt)
    : 0;
  const coldOpen =
    state.nextSegmentId === 0 ||
    !lastAt ||
    Date.now() - lastAt > COLD_OPEN_GAP_MS;

  const ctx = {
    coldOpen,
    previousTail: coldOpen ? undefined : state.lastTailTurns,
  };
  if (coldOpen) console.error("[loop] cold-open segment");

  const dialogue = await withRetry("script", () => generateDialogue(item, ctx));
  const audio = await withRetry("tts", () => renderTurns(dialogue.turns));
  const segmentId = state.nextSegmentId;
  await withRetry("encode", () =>
    writeSegment({ segmentId, item, dialogue, audio }),
  );

  const aired = [
    ...state.airedFingerprints,
    { fingerprint: fingerprint(item.title), airedAt: new Date().toISOString() },
  ];

  const next: State = {
    ...state,
    nextSegmentId: segmentId + 1,
    airedFingerprints: retainFingerprints(aired),
    lastTailTurns: dialogue.turns.slice(-2),
    lastGeneratedAt: new Date().toISOString(),
  };
  await writeState(next);
  console.error(`[loop] wrote seg-${String(segmentId).padStart(5, "0")}`);
  return next;
}

export async function runProducerLoop(): Promise<void> {
  await ensureDirs();
  let state = await readState();
  console.error(
    `[loop] start; nextSegmentId=${state.nextSegmentId}, playhead=${state.playhead.segmentId}`,
  );

  while (true) {
    try {
      // Re-read state so we pick up playhead updates from the stream server.
      state = await readState();
      const ahead = await bufferedSecondsAhead(state.playhead.segmentId);

      if (ahead < TARGET_BUFFER_SEC) {
        console.error(
          `[loop] buffer ${(ahead / 60).toFixed(1)}min < ${config.targetBufferMinutes}min; generating`,
        );
        try {
          state = await generateOne(state);
        } catch (e) {
          console.error("[loop] generation failed, skipping:", (e as Error).message);
        }
      } else {
        const deleted = await garbageCollect(state.playhead.segmentId);
        if (deleted > 0) console.error(`[loop] gc deleted ${deleted} segments`);
        console.error(
          `[loop] buffer ${(ahead / 60).toFixed(1)}min ok; sleeping ${IDLE_SLEEP_MS / 1000}s`,
        );
        await Bun.sleep(IDLE_SLEEP_MS);
      }
    } catch (e) {
      console.error("[loop] unexpected error:", (e as Error).message);
      await Bun.sleep(5000);
    }
  }
}
