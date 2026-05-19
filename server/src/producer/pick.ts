import { config } from "../shared/config.ts";
import type { RssItem, State } from "../shared/types.ts";
import { isDuplicate } from "./dedup.ts";
import { fetchAllFeeds } from "./rss.ts";

export async function pickNextArticle(state: State): Promise<RssItem> {
  const aired = state.airedFingerprints.map((f) => f.fingerprint);

  try {
    const items = await fetchAllFeeds();
    for (const it of items) {
      if (!it.title?.trim()) continue;
      if (!isDuplicate(it.title, aired)) return it;
    }
  } catch (e) {
    console.error("[pick] rss fetch failed:", (e as Error).message);
  }

  // Evergreen fallback: rotate based on how many evergreen topics have aired.
  const topicFps = new Set(
    config.evergreenTopics.map((t) =>
      [...new Set(t.toLowerCase().split(/\s+/))].sort().join(" "),
    ),
  );
  const evergreenAired = state.airedFingerprints.filter((f) =>
    topicFps.has(
      [...new Set(f.fingerprint.split(" "))].sort().join(" "),
    ),
  ).length;
  const topics = config.evergreenTopics;
  const topic = topics[evergreenAired % topics.length]!;
  return {
    title: topic,
    summary: "",
    url: "",
    source: "evergreen",
    publishedAt: new Date().toISOString(),
  };
}
