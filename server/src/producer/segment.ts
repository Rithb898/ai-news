import { mkdir, rename } from "node:fs/promises";
import { paths } from "../shared/paths.ts";
import type { Dialogue, RssItem, SegmentMeta } from "../shared/types.ts";
import { encodeMp3 } from "./encode.ts";
import { sliceToHls } from "./hls.ts";
import { renderTurns, type RenderedAudio } from "./tts.ts";

export async function ensureDirs(): Promise<void> {
  await Promise.all([
    mkdir(paths.segments, { recursive: true }),
    mkdir(paths.meta, { recursive: true }),
    mkdir(paths.scripts, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.hls, { recursive: true }),
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

export interface WriteSegmentInput {
  segmentId: number;
  item: RssItem;
  dialogue: Dialogue;
  audio: RenderedAudio;
}

export async function writeSegment(
  input: WriteSegmentInput,
): Promise<BuildSegmentResult> {
  await ensureDirs();
  const { segmentId, item, dialogue, audio } = input;

  const mp3Path = paths.segment(segmentId);
  const metaPath = paths.segmentMeta(segmentId);
  const mp3Tmp = `${mp3Path}.tmp`;
  const metaTmp = `${metaPath}.tmp`;

  await encodeMp3(audio.wav, mp3Tmp);
  // Put MP3 in place so the slicer reads a stable file.
  await rename(mp3Tmp, mp3Path);

  const chunks = await sliceToHls(segmentId, mp3Path);

  const scriptText = dialogue.turns
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  const meta: SegmentMeta = {
    segmentId,
    title: item.title,
    source: item.source,
    url: item.url,
    durationSec: audio.durationSec,
    scriptText,
    generatedAt: new Date().toISOString(),
    chunks,
  };

  await Bun.write(metaTmp, JSON.stringify(meta, null, 2));
  // Rename meta last so consumers only see the segment when chunks + meta are ready.
  await rename(metaTmp, metaPath);

  return { mp3Path, metaPath, meta };
}

export async function buildSegment(
  input: BuildSegmentInput,
): Promise<BuildSegmentResult> {
  const audio = await renderTurns(input.dialogue.turns);
  return writeSegment({ ...input, audio });
}
