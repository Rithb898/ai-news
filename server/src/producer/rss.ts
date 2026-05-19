import { XMLParser } from "fast-xml-parser";
import { config } from "../shared/config.ts";
import type { RssItem } from "../shared/types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "#cdata",
});

function pickText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return pickText(o["#cdata"] ?? o["#text"] ?? "");
  }
  return String(v);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sourceFromUrl(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function parseFeed(xml: string, feedUrl: string): RssItem[] {
  const doc = parser.parse(xml) as any;
  const source = sourceFromUrl(feedUrl);

  // RSS 2.0
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    const items = Array.isArray(rssItems) ? rssItems : [rssItems];
    return items.map((it: any) => ({
      title: stripHtml(pickText(it.title)),
      summary: stripHtml(pickText(it.description ?? it["content:encoded"])),
      url: pickText(it.link),
      source,
      publishedAt: pickText(it.pubDate) || new Date().toISOString(),
    }));
  }

  // Atom
  const atomEntries = doc?.feed?.entry;
  if (atomEntries) {
    const items = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    return items.map((it: any) => {
      const link = Array.isArray(it.link) ? it.link[0] : it.link;
      const href = link?.["@_href"] ?? pickText(link);
      return {
        title: stripHtml(pickText(it.title)),
        summary: stripHtml(pickText(it.summary ?? it.content)),
        url: href,
        source,
        publishedAt:
          pickText(it.updated) || pickText(it.published) || new Date().toISOString(),
      };
    });
  }

  return [];
}

export async function fetchAllFeeds(): Promise<RssItem[]> {
  const results = await Promise.allSettled(
    config.rssFeeds.map(async (u) => {
      const res = await fetch(u, {
        headers: { "user-agent": "ai-news-radio/0.1" },
      });
      if (!res.ok) throw new Error(`${u}: ${res.status}`);
      return parseFeed(await res.text(), u);
    }),
  );

  const items: RssItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else console.error("[rss]", r.reason);
  }

  items.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  return items;
}
