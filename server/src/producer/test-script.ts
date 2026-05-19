import { fetchAllFeeds } from "./rss.ts";
import { generateDialogue } from "./script.ts";

const idx = Number(process.argv[2] ?? "0");
if (!Number.isFinite(idx) || idx < 0) {
  console.error("usage: bun run src/producer/test-script.ts <rss-item-index>");
  process.exit(1);
}

const items = await fetchAllFeeds();
console.error(`[test-script] fetched ${items.length} items`);
const item = items[idx];
if (!item) {
  console.error(`no item at index ${idx} (max ${items.length - 1})`);
  process.exit(1);
}

console.error(`[test-script] ${item.source} — ${item.title}`);
console.error(`[test-script] ${item.url}`);

const dialogue = await generateDialogue(item);

const wc = dialogue.turns.reduce(
  (n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length,
  0,
);
console.error(`[test-script] ${dialogue.turns.length} turns, ${wc} words\n`);

for (const t of dialogue.turns) {
  console.log(`${t.speaker}: ${t.text}`);
}
