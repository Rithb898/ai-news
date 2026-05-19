import { readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../shared/config.ts";
import { paths } from "../shared/paths.ts";
import type { SegmentMeta } from "../shared/types.ts";

async function listMetas(): Promise<SegmentMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(paths.meta);
  } catch {
    return [];
  }
  const out: SegmentMeta[] = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = (await Bun.file(join(paths.meta, f)).json()) as SegmentMeta;
      out.push(m);
    } catch {
      // skip malformed
    }
  }
  out.sort((a, b) => a.segmentId - b.segmentId);
  return out;
}

export async function bufferedSecondsAhead(
  playheadSegmentId: number,
): Promise<number> {
  const metas = await listMetas();
  let total = 0;
  for (const m of metas) {
    if (m.segmentId >= playheadSegmentId) total += m.durationSec;
  }
  return total;
}

// Delete segments + meta strictly behind the playhead with cumulative aired
// duration ≥ gcGraceMinutes. Approximates "played ≥ N minutes ago" without
// recording per-segment play timestamps.
export async function garbageCollect(playheadSegmentId: number): Promise<number> {
  const metas = await listMetas();
  const past = metas.filter((m) => m.segmentId < playheadSegmentId);
  if (past.length === 0) return 0;

  const graceSec = config.gcGraceMinutes * 60;
  // Walk newest-first behind playhead, summing durations; delete once cumulative ≥ grace.
  past.sort((a, b) => b.segmentId - a.segmentId);
  let cum = 0;
  let deleted = 0;
  for (const m of past) {
    if (cum >= graceSec) {
      const mp3 = paths.segment(m.segmentId);
      const meta = paths.segmentMeta(m.segmentId);
      const hlsDir = paths.hlsSegmentDir(m.segmentId);
      await Promise.allSettled([
        unlink(mp3),
        unlink(meta),
        rm(hlsDir, { recursive: true, force: true }),
      ]);
      deleted++;
    }
    cum += m.durationSec;
  }
  return deleted;
}
