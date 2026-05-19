import { $ } from "bun";

export async function encodeMp3(wav: Uint8Array, outPath: string): Promise<void> {
  // -i pipe:0  read WAV from stdin
  // -ac 1     mono
  // -b:a 128k constant 128 kbps
  // -f mp3    force mp3 muxer
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-loglevel", "error",
      "-y",
      "-i", "pipe:0",
      "-ac", "1",
      "-b:a", "128k",
      "-f", "mp3",
      outPath,
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  proc.stdin.write(wav);
  await proc.stdin.end();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exit ${code}: ${err}`);
  }
}

export async function probeDuration(path: string): Promise<number> {
  const out = await $`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${path}`.text();
  const n = parseFloat(out.trim());
  if (!Number.isFinite(n)) throw new Error(`ffprobe bad duration: ${out}`);
  return n;
}
