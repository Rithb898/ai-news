// Benchmarks Kokoro TTS across dtypes on this machine.
// Usage:
//   bun run src/producer/bench-kokoro.ts
//   bun run src/producer/bench-kokoro.ts q8 q4f16        # subset
//   BENCH_TEXT="..." BENCH_RUNS=3 bun run src/producer/bench-kokoro.ts

import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const ALL_DTYPES = ["fp32", "fp16", "q8", "q4", "q4f16"] as const;
type Dtype = (typeof ALL_DTYPES)[number];

const VOICE = "af_bella";
const SPEED = 1.25;
const TEXT =
  process.env.BENCH_TEXT ??
  "Content provenance for AI media is getting harder to ignore. " +
    "The idea is to help people trust what they're seeing by adding signals " +
    "that show where the content came from, especially when AI is involved.";
const RUNS = Number(process.env.BENCH_RUNS ?? "2");

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const dtypes: Dtype[] = (args.length
  ? args.filter((a): a is Dtype => (ALL_DTYPES as readonly string[]).includes(a))
  : [...ALL_DTYPES]);

const wordCount = TEXT.trim().split(/\s+/).length;
console.log(`text: ${wordCount} words, ${TEXT.length} chars`);
console.log(`runs per dtype: ${RUNS}, voice: ${VOICE}, speed: ${SPEED}`);
console.log(`dtypes: ${dtypes.join(", ")}\n`);

interface Row {
  dtype: Dtype;
  loadMs: number;
  firstGenMs: number;
  warmGenMsAvg: number;
  audioSec: number;
  rtf: number; // realtime factor: audioSec / wallSec (higher = faster)
  rss?: number; // MB
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

function mem(): number {
  const m = process.memoryUsage().rss;
  return m / 1024 / 1024;
}

const results: Row[] = [];

for (const dtype of dtypes) {
  console.log(`── ${dtype} ──`);
  try {
    const memBefore = mem();
    const tLoad = performance.now();
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device: "cpu",
    });
    const loadMs = performance.now() - tLoad;
    console.log(`  load:        ${fmt(loadMs)} ms`);

    let firstGenMs = 0;
    let audioSec = 0;
    const warmTimes: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const out = await tts.generate(TEXT, { voice: VOICE, speed: SPEED } as any);
      const dt = performance.now() - t0;
      if (i === 0) {
        firstGenMs = dt;
        audioSec = out.audio.length / out.sampling_rate;
        console.log(
          `  gen #1:      ${fmt(dt)} ms  (audio ${fmt(audioSec, 2)}s)`,
        );
      } else {
        warmTimes.push(dt);
        console.log(`  gen #${i + 1}:      ${fmt(dt)} ms`);
      }
    }

    const warmAvg =
      warmTimes.length > 0
        ? warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length
        : firstGenMs;
    const rtf = audioSec / (warmAvg / 1000);
    const rss = mem() - memBefore;

    console.log(`  warm avg:    ${fmt(warmAvg)} ms`);
    console.log(`  realtime x:  ${fmt(rtf, 2)}  (audio_sec / wall_sec)`);
    console.log(`  rss delta:   ${fmt(rss)} MB\n`);

    results.push({
      dtype,
      loadMs,
      firstGenMs,
      warmGenMsAvg: warmAvg,
      audioSec,
      rtf,
      rss,
    });

    // Hint GC between runs.
    (tts as unknown as { model?: { dispose?: () => void } }).model?.dispose?.();
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}\n`);
  }
}

console.log("─── summary ───");
console.log(
  "dtype   load(ms)  first(ms)  warm(ms)  rtf    rss(MB)",
);
for (const r of results) {
  console.log(
    `${r.dtype.padEnd(6)}  ${fmt(r.loadMs).padStart(7)}  ${fmt(r.firstGenMs).padStart(8)}  ${fmt(r.warmGenMsAvg).padStart(7)}  ${fmt(r.rtf, 2).padStart(4)}  ${fmt(r.rss ?? 0).padStart(6)}`,
  );
}

const best = [...results].sort((a, b) => b.rtf - a.rtf)[0];
if (best) {
  console.log(`\nfastest (warm): ${best.dtype}  @  ${fmt(best.rtf, 2)}x realtime`);
}
