import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../shared/config.ts";
import { paths } from "../shared/paths.ts";
import type { HlsChunk } from "../shared/types.ts";
import { probeDuration } from "./encode.ts";

// Slice an MP3 segment into AAC/MPEG-TS chunks for HLS.
// Writes into hls/seg-NNNNN/.tmp/ first, then renames into place atomically.
export async function sliceToHls(
  segmentId: number,
  mp3Path: string,
): Promise<HlsChunk[]> {
  const finalDir = paths.hlsSegmentDir(segmentId);
  const tmpDir = `${finalDir}.tmp`;

  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-loglevel", "error",
      "-y",
      "-i", mp3Path,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "1",
      "-f", "segment",
      "-segment_time", String(config.hls.chunkDurationSec),
      "-segment_format", "mpegts",
      "-reset_timestamps", "1",
      join(tmpDir, "chunk-%03d.ts"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`ffmpeg hls slice exit ${code}: ${err}`);
  }

  const names = (await readdir(tmpDir))
    .filter((f) => f.endsWith(".ts"))
    .sort();
  if (names.length === 0) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`hls slice produced 0 chunks for seg-${segmentId}`);
  }

  const chunks: HlsChunk[] = [];
  for (const name of names) {
    const dur = await probeDuration(join(tmpDir, name));
    chunks.push({ file: name, durationSec: dur });
  }

  // Atomic dir swap.
  await rm(finalDir, { recursive: true, force: true });
  await rename(tmpDir, finalDir);

  return chunks;
}
