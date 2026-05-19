export type Speaker = "HOST_A" | "HOST_B";

export interface Turn {
  speaker: Speaker;
  text: string;
}

export interface HlsChunk {
  file: string;
  durationSec: number;
}

export interface SegmentMeta {
  segmentId: number;
  title: string;
  source: string;
  url: string;
  durationSec: number;
  scriptText: string;
  generatedAt: string;
  chunks: HlsChunk[];
}

export interface Playhead {
  segmentId: number;
  chunkIndex: number;
}

export interface State {
  playhead: Playhead;
  airedFingerprints: { fingerprint: string; airedAt: string }[];
  nextSegmentId: number;
  lastTailTurns?: Turn[];
  lastGeneratedAt?: string;
}

export interface RssItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface Dialogue {
  turns: Turn[];
}
