// Minimal 16-bit PCM mono WAV encoder.
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const byteRate = sampleRate * 2;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);        // PCM chunk size
  v.setUint16(20, 1, true);         // format = PCM
  v.setUint16(22, 1, true);         // channels = 1
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 2, true);         // block align
  v.setUint16(34, 16, true);        // bits per sample
  writeStr(36, "data");
  v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i]!;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }

  return new Uint8Array(buf);
}
