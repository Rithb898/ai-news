import { KokoroTTS } from "kokoro-js";
import { config } from "../shared/config.ts";
import type { Turn } from "../shared/types.ts";
import { encodeWav } from "../shared/wav.ts";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SILENCE_MS = 60;

let _tts: Promise<KokoroTTS> | null = null;

export function loadTTS(): Promise<KokoroTTS> {
  if (!_tts) {
    _tts = KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q4f16", device: "cpu" });
  }
  return _tts;
}

export interface RenderedAudio {
  wav: Uint8Array;
  durationSec: number;
  sampleRate: number;
}

export async function renderTurns(turns: Turn[]): Promise<RenderedAudio> {
  const tts = await loadTTS();
  const chunks: Float32Array[] = [];
  let sampleRate = 0;

  for (const t of turns) {
    const voice = config.voices[t.speaker];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await tts.generate(t.text, { voice, speed: 1.25 } as any);
    if (!sampleRate) sampleRate = out.sampling_rate;
    chunks.push(out.audio);
  }

  const silence = new Float32Array(Math.round((sampleRate * SILENCE_MS) / 1000));

  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    total += chunks[i]!.length;
    if (i < chunks.length - 1) total += silence.length;
  }

  const merged = new Float32Array(total);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i]!, off);
    off += chunks[i]!.length;
    if (i < chunks.length - 1) {
      merged.set(silence, off);
      off += silence.length;
    }
  }

  return {
    wav: encodeWav(merged, sampleRate),
    durationSec: merged.length / sampleRate,
    sampleRate,
  };
}
