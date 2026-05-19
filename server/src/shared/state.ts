import { paths } from "./paths.ts";
import type { State } from "./types.ts";

const empty: State = {
  playhead: { segmentId: 0, byteOffset: 0 },
  airedFingerprints: [],
  nextSegmentId: 0,
};

export async function readState(): Promise<State> {
  const f = Bun.file(paths.state);
  if (!(await f.exists())) return structuredClone(empty);
  try {
    return (await f.json()) as State;
  } catch {
    return structuredClone(empty);
  }
}

export async function writeState(s: State): Promise<void> {
  const tmp = `${paths.state}.tmp`;
  await Bun.write(tmp, JSON.stringify(s, null, 2));
  await Bun.$`mv ${tmp} ${paths.state}`.quiet();
}
