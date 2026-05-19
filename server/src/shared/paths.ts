import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? "/data";

function segName(id: number): string {
  return `seg-${String(id).padStart(5, "0")}`;
}

export const paths = {
  data: DATA_DIR,
  segments: join(DATA_DIR, "segments"),
  meta: join(DATA_DIR, "meta"),
  scripts: join(DATA_DIR, "scripts"),
  logs: join(DATA_DIR, "logs"),
  hls: join(DATA_DIR, "hls"),
  state: join(DATA_DIR, "state.json"),
  segName,
  segment: (id: number) =>
    join(DATA_DIR, "segments", `${segName(id)}.mp3`),
  segmentMeta: (id: number) =>
    join(DATA_DIR, "meta", `${segName(id)}.json`),
  hlsSegmentDir: (id: number) => join(DATA_DIR, "hls", segName(id)),
  hlsChunk: (id: number, chunkIndex: number) =>
    join(
      DATA_DIR,
      "hls",
      segName(id),
      `chunk-${String(chunkIndex).padStart(3, "0")}.ts`,
    ),
  log: (name: "producer" | "stream") => join(DATA_DIR, "logs", `${name}.log`),
};
