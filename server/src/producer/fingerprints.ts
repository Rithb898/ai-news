import { config } from "../shared/config.ts";
import type { State } from "../shared/types.ts";

export function retainFingerprints(
  fps: State["airedFingerprints"],
): State["airedFingerprints"] {
  const cutoff = Date.now() - config.fingerprintRetentionDays * 86_400_000;
  return fps.filter((f) => new Date(f.airedAt).getTime() >= cutoff);
}
