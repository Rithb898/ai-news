import { readState } from "../shared/state.ts";
import { fetchAllFeeds } from "./rss.ts";
import { generateDialogue } from "./script.ts";
import { buildSegment } from "./segment.ts";

const idx = Number(process.argv[2] ?? "0");
if (!Number.isFinite(idx) || idx < 0) {
  console.error("usage: bun run src/producer/test-segment.ts <rss-item-index>");
  process.exit(1);
}

const items = await fetchAllFeeds();
const item = items[idx];
if (!item) {
  console.error(`no item at index ${idx} (max ${items.length - 1})`);
  process.exit(1);
}
console.error(`[test-segment] ${item.source} — ${item.title}`);

const dialogue = await generateDialogue(item);
console.error(`[test-segment] ${dialogue.turns.length} turns; rendering TTS…`);

const state = await readState();
const segmentId = state.nextSegmentId;

const { mp3Path, metaPath, meta } = await buildSegment({
  segmentId,
  item,
  dialogue,
});

console.error(
  `[test-segment] wrote ${mp3Path} (${meta.durationSec.toFixed(1)}s)`,
);
console.error(`[test-segment] wrote ${metaPath}`);
