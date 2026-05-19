import { config } from "../shared/config.ts";

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "for", "to", "from",
  "by", "with", "is", "are", "was", "were", "be", "been", "as", "at", "it",
  "this", "that", "these", "those", "new", "how", "why", "what", "we", "you",
]);

export function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function fingerprint(title: string): string {
  return [...tokenize(title)].sort().join(" ");
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function isDuplicate(title: string, aired: string[]): boolean {
  const t = tokenize(title);
  for (const fp of aired) {
    const set = new Set(fp.split(" "));
    if (jaccard(t, set) >= config.dedupJaccardThreshold) return true;
  }
  return false;
}
