import { readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../shared/config.ts";
import { paths } from "../shared/paths.ts";
import { readState, writeState } from "../shared/state.ts";
import type { Playhead, SegmentMeta, State } from "../shared/types.ts";

const PERSIST_INTERVAL_MS = 2_000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 20;

type SseSub = {
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const enc = new TextEncoder();

interface WindowEntry {
  segmentId: number;
  chunkIndex: number;
  durationSec: number;
  // Monotonic media sequence assigned when entry first enters the window.
  mediaSequence: number;
}

// Tracks unique playlist fetchers within a TTL window.
class ListenerTracker {
  private seen = new Map<string, number>();
  private listeners = new Set<() => void>();

  touch(id: string): void {
    const before = this.count();
    this.seen.set(id, Date.now());
    const after = this.count();
    if (after !== before) this.fire();
  }

  count(): number {
    const cutoff = Date.now() - config.hls.listenerTtlMs;
    let n = 0;
    for (const [k, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(k);
      else n++;
    }
    return n;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private fire(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
}

export class PlaylistEngine {
  private state!: State;
  private sseSubs = new Set<SseSub>();
  private listeners = new ListenerTracker();
  private window: WindowEntry[] = [];
  private nextMediaSeq = 0;
  // Wall-clock time the current head chunk started playing.
  private currentChunkStartedAt = 0;
  private metaCache = new Map<number, SegmentMeta>();
  private currentMeta: SegmentMeta | null = null;
  private dirty = false;
  private lastPersist = 0;
  private started = false;
  private lastReportedListeners = -1;

  async init(): Promise<void> {
    this.state = await readState();
    await this.fastForwardStale();
    await this.refreshMetaCache();
    await this.initWindow();
    if (!this.started) {
      this.started = true;
      this.tickLoop();
    }
    this.listeners.onChange(() => this.broadcastListeners());
  }

  // ---------- public surface ----------

  listenerCount(): number {
    return this.listeners.count();
  }

  touchListener(id: string): void {
    this.listeners.touch(id);
  }

  hasPlaylist(): boolean {
    return this.window.length > 0;
  }

  nowPlaying(): SegmentMeta | null {
    return this.currentMeta;
  }

  async bufferedSecondsAhead(): Promise<number> {
    await this.refreshMetaCache();
    let total = 0;
    for (const m of this.metaCache.values()) {
      if (m.segmentId >= this.state.playhead.segmentId) total += m.durationSec;
    }
    return total;
  }

  async history(): Promise<SegmentMeta[]> {
    await this.refreshMetaCache();
    return [...this.metaCache.values()]
      .filter((m) => m.segmentId < this.state.playhead.segmentId)
      .sort((a, b) => a.segmentId - b.segmentId)
      .slice(-HISTORY_LIMIT);
  }

  renderPlaylist(): string {
    if (this.window.length === 0) return "";
    const lines: string[] = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${config.hls.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.window[0]!.mediaSequence}`,
    ];
    let prevSeg: number | null = null;
    for (const e of this.window) {
      if (prevSeg !== null && e.segmentId !== prevSeg) {
        lines.push("#EXT-X-DISCONTINUITY");
      }
      lines.push(`#EXTINF:${e.durationSec.toFixed(3)},`);
      lines.push(`/hls/${paths.segName(e.segmentId)}/chunk-${pad3(e.chunkIndex)}.ts`);
      prevSeg = e.segmentId;
    }
    return `${lines.join("\n")}\n`;
  }

  // ---------- SSE ----------

  addSse(controller: ReadableStreamDefaultController<Uint8Array>): SseSub {
    const sub: SseSub = { controller };
    this.sseSubs.add(sub);
    void this.sendInitial(sub);
    return sub;
  }

  removeSse(sub: SseSub): void {
    this.sseSubs.delete(sub);
  }

  private async sendInitial(sub: SseSub): Promise<void> {
    if (this.currentMeta) this.sseSend(sub, "nowPlaying", this.currentMeta);
    this.sseSend(sub, "listeners", { count: this.listeners.count() });
    const hist = await this.history();
    this.sseSend(sub, "history", hist);
  }

  private sseSend(sub: SseSub, event: string, data: unknown): void {
    try {
      sub.controller.enqueue(
        enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      this.sseSubs.delete(sub);
    }
  }

  private sseBroadcast(event: string, data: unknown): void {
    for (const s of [...this.sseSubs]) this.sseSend(s, event, data);
  }

  private broadcastListeners(): void {
    const n = this.listeners.count();
    if (n === this.lastReportedListeners) return;
    this.lastReportedListeners = n;
    this.sseBroadcast("listeners", { count: n });
  }

  // ---------- window mgmt ----------

  private async initWindow(): Promise<void> {
    // Fill the window starting at the persisted playhead.
    const start = this.state.playhead;
    const meta = await this.getMeta(start.segmentId);
    if (!meta) return;
    let segId = start.segmentId;
    let chunkIdx = start.chunkIndex;
    if (chunkIdx >= meta.chunks.length) {
      // Persisted index past end — reset.
      segId += 1;
      chunkIdx = 0;
      this.state.playhead = { segmentId: segId, chunkIndex: 0 };
      this.dirty = true;
    }
    this.currentMeta = (await this.getMeta(segId)) ?? null;

    let added = 0;
    while (added < config.hls.windowSize) {
      const m = await this.getMeta(segId);
      if (!m) break;
      if (chunkIdx >= m.chunks.length) {
        segId += 1;
        chunkIdx = 0;
        continue;
      }
      const c = m.chunks[chunkIdx]!;
      this.window.push({
        segmentId: m.segmentId,
        chunkIndex: chunkIdx,
        durationSec: c.durationSec,
        mediaSequence: this.nextMediaSeq++,
      });
      chunkIdx++;
      added++;
    }
    if (this.window.length > 0) this.currentChunkStartedAt = Date.now();
  }

  private async appendNext(): Promise<boolean> {
    // Append the chunk that comes after the last one currently in the window.
    const tail = this.window[this.window.length - 1];
    let segId: number;
    let chunkIdx: number;
    if (tail) {
      segId = tail.segmentId;
      chunkIdx = tail.chunkIndex + 1;
    } else {
      segId = this.state.playhead.segmentId;
      chunkIdx = this.state.playhead.chunkIndex;
    }
    let meta = await this.getMeta(segId);
    while (meta && chunkIdx >= meta.chunks.length) {
      segId += 1;
      chunkIdx = 0;
      meta = await this.getMeta(segId);
    }
    if (!meta) return false;
    const c = meta.chunks[chunkIdx];
    if (!c) return false;
    this.window.push({
      segmentId: meta.segmentId,
      chunkIndex: chunkIdx,
      durationSec: c.durationSec,
      mediaSequence: this.nextMediaSeq++,
    });
    return true;
  }

  // ---------- tick loop ----------

  private async tickLoop(): Promise<void> {
    while (true) {
      try {
        await this.tick();
      } catch (e) {
        console.error("[stream] tick error:", (e as Error).message);
      }
      await Bun.sleep(250);
    }
  }

  private async tick(): Promise<void> {
    // No listeners: freeze advancement.
    if (this.listeners.count() === 0) {
      await this.maybePersist();
      // Still keep window populated if it's short and segments exist.
      if (this.window.length === 0) {
        await this.initWindow();
      }
      return;
    }

    // Cold start: nothing in window yet.
    if (this.window.length === 0) {
      await this.initWindow();
      if (this.window.length === 0) return;
    }

    const head = this.window[0]!;
    const elapsed = (Date.now() - this.currentChunkStartedAt) / 1000;
    if (elapsed < head.durationSec) return;

    // Try to append the next chunk before evicting the head, so we never
    // serve a playlist shorter than the window when we can avoid it.
    const appended = await this.appendNext();
    if (!appended) {
      // No new chunk available; hold position, don't rotate.
      return;
    }

    this.window.shift();
    this.currentChunkStartedAt += head.durationSec * 1000;

    // Advance the persisted playhead to whatever now sits at the head.
    const newHead = this.window[0]!;
    const prevSeg = this.state.playhead.segmentId;
    this.state.playhead = {
      segmentId: newHead.segmentId,
      chunkIndex: newHead.chunkIndex,
    };
    this.dirty = true;

    if (newHead.segmentId !== prevSeg) {
      const meta = await this.getMeta(newHead.segmentId);
      this.currentMeta = meta ?? null;
      if (meta) this.sseBroadcast("nowPlaying", meta);
      const hist = await this.history();
      this.sseBroadcast("history", hist);
    }

    await this.maybePersist();
    await this.gcEvicted();
  }

  // ---------- meta + gc ----------

  private async refreshMetaCache(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(paths.meta);
    } catch {
      return;
    }
    const seen = new Set<number>();
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      try {
        const m = (await Bun.file(join(paths.meta, f)).json()) as SegmentMeta;
        this.metaCache.set(m.segmentId, m);
        seen.add(m.segmentId);
      } catch {}
    }
    for (const id of [...this.metaCache.keys()]) {
      if (!seen.has(id)) this.metaCache.delete(id);
    }
  }

  private async getMeta(segmentId: number): Promise<SegmentMeta | null> {
    const cached = this.metaCache.get(segmentId);
    if (cached) return cached;
    const f = Bun.file(paths.segmentMeta(segmentId));
    if (!(await f.exists())) return null;
    try {
      const m = (await f.json()) as SegmentMeta;
      this.metaCache.set(segmentId, m);
      return m;
    } catch {
      return null;
    }
  }

  private async gcEvicted(): Promise<void> {
    // Anything strictly behind the segment at the window head is eligible for GC
    // after the configured grace period (we don't track per-eviction timestamps;
    // the grace is implicitly the time from eviction to the next gc pass + idle).
    const headSeg = this.window[0]?.segmentId ?? this.state.playhead.segmentId;
    const graceCutoff = Date.now() - config.hls.chunkGraceSec * 1000;
    for (const m of [...this.metaCache.values()]) {
      if (m.segmentId >= headSeg) continue;
      const gen = Date.parse(m.generatedAt);
      if (Number.isFinite(gen) && gen > graceCutoff) continue;
      await Promise.allSettled([
        unlink(paths.segment(m.segmentId)),
        unlink(paths.segmentMeta(m.segmentId)),
        rm(paths.hlsSegmentDir(m.segmentId), { recursive: true, force: true }),
      ]);
      this.metaCache.delete(m.segmentId);
    }
  }

  private async fastForwardStale(): Promise<void> {
    while (true) {
      const id = this.state.playhead.segmentId;
      const metaFile = Bun.file(paths.segmentMeta(id));
      if (!(await metaFile.exists())) return;
      let meta: SegmentMeta;
      try {
        meta = (await metaFile.json()) as SegmentMeta;
      } catch {
        return;
      }
      const age = Date.now() - new Date(meta.generatedAt).getTime();
      if (age <= STALE_AGE_MS) return;
      console.error(
        `[stream] dropping stale seg-${id} (age ${(age / 3600_000).toFixed(1)}h)`,
      );
      await Promise.allSettled([
        unlink(paths.segment(id)),
        unlink(paths.segmentMeta(id)),
        rm(paths.hlsSegmentDir(id), { recursive: true, force: true }),
      ]);
      this.state.playhead = { segmentId: id + 1, chunkIndex: 0 };
      this.dirty = true;
    }
  }

  private async maybePersist(): Promise<void> {
    if (!this.dirty) return;
    const now = Date.now();
    if (now - this.lastPersist < PERSIST_INTERVAL_MS) return;
    this.lastPersist = now;
    this.dirty = false;
    try {
      await writeState(this.state);
    } catch (e) {
      console.error("[stream] persist failed:", (e as Error).message);
      this.dirty = true;
    }
  }

  // For external introspection (health route).
  playhead(): Playhead {
    return this.state.playhead;
  }
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export const playlist = new PlaylistEngine();
