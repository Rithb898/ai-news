import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? "/data";

export const paths = {
  data: DATA_DIR,
  segments: join(DATA_DIR, "segments"),
  meta: join(DATA_DIR, "meta"),
  scripts: join(DATA_DIR, "scripts"),
  logs: join(DATA_DIR, "logs"),
  state: join(DATA_DIR, "state.json"),
  segment: (id: number) =>
    join(DATA_DIR, "segments", `seg-${String(id).padStart(5, "0")}.mp3`),
  segmentMeta: (id: number) =>
    join(DATA_DIR, "meta", `seg-${String(id).padStart(5, "0")}.json`),
  log: (name: "producer" | "stream") => join(DATA_DIR, "logs", `${name}.log`),
};
