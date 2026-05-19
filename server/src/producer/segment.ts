import { mkdir, rename } from "node:fs/promises";
import { paths } from "../shared/paths.ts";
import type { Dialogue, RssItem, SegmentMeta } from "../shared/types.ts";
import { encodeMp3 } from "./encode.ts";
import { renderTurns } from "./tts.ts";

export async function ensureDirs(): Promise<void> {
  await Promise.all([
    mkdir(paths.segments, { recursive: true }),
    mkdir(paths.meta, { recursive: true }),
    mkdir(paths.scripts, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
  ]);
}

export interface BuildSegmentInput {
  segmentId: number;
  item: RssItem;
  dialogue: Dialogue;
}

export interface BuildSegmentResult {
  mp3Path: string;
  metaPath: string;
  meta: SegmentMeta;
}

export async function buildSegment(
  input: BuildSegmentInput,
): Promise<BuildSegmentResult> {
  await ensureDirs();
  const { segmentId, item, dialogue } = input;

  const { wav, durationSec } = await renderTurns(dialogue.turns);

  const mp3Path = paths.segment(segmentId);
  const metaPath = paths.segmentMeta(segmentId);
  const mp3Tmp = `${mp3Path}.tmp`;
  const metaTmp = `${metaPath}.tmp`;

  await encodeMp3(wav, mp3Tmp);

  const scriptText = dialogue.turns
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  const meta: SegmentMeta = {
    segmentId,
    title: item.title,
    source: item.source,
    url: item.url,
    durationSec,
    scriptText,
    generatedAt: new Date().toISOString(),
  };

  await Bun.write(metaTmp, JSON.stringify(meta, null, 2));

  // Rename mp3 first so meta only appears once the audio is in place.
  await rename(mp3Tmp, mp3Path);
  await rename(metaTmp, metaPath);

  return { mp3Path, metaPath, meta };
}
