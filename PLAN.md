# Implementation Plan

## Part 1 — Continuous script (no per-segment cold opens)

### Changes

**`shared/types.ts`**
- Add `lastTailTurns?: Turn[]` to `State` — last 2 turns of most recently *generated* segment.
- Optional: track `lastGeneratedAt` to detect post-idle resume.

**`producer/prompts.ts`**
- Rewrite `SYSTEM_PROMPT`:
  - Frame as "a continuous live radio show, mid-broadcast".
  - Forbidden phrases list: `welcome`, `welcome back`, `today's topic`, `today we're`, `in today's news`, `good morning/afternoon/evening`, `tune in`, `that's all for`, `thanks for listening`.
  - Required: open with a transition (`Speaking of`, `On a related note`, `Switching gears`, `Next up`, `Moving on`, `That reminds me`, or a direct reaction to the prior turn).
  - Close without sign-off; just trail into the next topic.
  - Cold-open exception triggered by a flag in user prompt.
- New `userPromptForArticle(item, ctx)` where `ctx = { previousTail?: Turn[]; coldOpen: boolean }`.
  - If `previousTail`, inject: `Previous segment ended with:\n  HOST_X: "…"\n  HOST_Y: "…"\nContinue naturally from this. The opening host should be the *other* host from whoever spoke last.`
  - If `coldOpen`, add: `This is the start of the broadcast — a brief welcome is allowed.`

**`producer/script.ts`**
- Accept `ctx` and pass through.
- Post-validation: regex reject on forbidden phrases when not cold-open → retry up to 2x with a stricter reminder appended; on final failure, accept (don't crash the loop).

**`producer/loop.ts`**
- Before generation: read `state.lastTailTurns`. Compute `coldOpen = state.nextSegmentId === 0 || (now - lastGeneratedAt) > 10min`.
- Pass `ctx` into `generateDialogue`.
- After successful generation: update `state.lastTailTurns = dialogue.turns.slice(-2)`, `state.lastGeneratedAt = now`.

### Why this shape

- One LLM call per segment, same as now. No new failure modes.
- System prompt remains static → prompt cache hit stays high. Only user prompt varies.
- Cold-open flag handles the "fresh boot after long downtime" case automatically.
- Regex validator is cheap insurance; the prompt does the real work.

---

## Part 2 — HLS streaming

### Filesystem contract (new layout)

```
/data/
  segments/seg-NNNNN.mp3          # keep for now; intermediate
  meta/seg-NNNNN.json
  hls/
    seg-NNNNN/
      chunk-000.ts
      chunk-001.ts
      ...
  live.m3u8                       # the rolling live playlist (what clients hit)
  state.json
```

Single global `live.m3u8` is simpler than per-segment playlists. It lists the *current window* of chunks across segment boundaries.

### Producer changes

**`producer/hls.ts`** (new)
- `sliceToHls(segmentId, mp3Path) → { chunkPaths: string[], chunkDurations: number[] }`.
- ffmpeg call: `ffmpeg -i seg-NNNNN.mp3 -c:a aac -b:a 128k -f segment -segment_time 4 -segment_format mpegts hls/seg-NNNNN/chunk-%03d.ts`.
- Returns chunk count + actual durations (parse from segment muxer or probe).

**`producer/segment.ts`**
- After `encodeMp3`, also call `sliceToHls`.
- Add `chunks: { file: string; durationSec: number }[]` to `SegmentMeta`.
- Atomic: slice into `hls/seg-NNNNN/.tmp/`, rename dir, then rename meta.

**`shared/types.ts`**
- Extend `SegmentMeta` with `chunks: HlsChunk[]`.
- `Playhead` becomes `{ segmentId: number; chunkIndex: number }`.

### Stream server rewrite

**`stream/playlist.ts`** (new)
- Maintains in-memory rolling window: last 10 chunk descriptors across the most recent segment(s).
- `currentPlaylist(): string` → renders `#EXTM3U` text with `#EXT-X-VERSION:3`, `#EXT-X-TARGETDURATION:5`, `#EXT-X-MEDIA-SEQUENCE:<n>`, then 10 × `#EXTINF:<dur>,\n<url>`.
- No `#EXT-X-ENDLIST` (live).
- Advance window: when listeners > 0, every `chunkDuration` seconds, append next chunk + bump media sequence + drop oldest. When listeners = 0, freeze.
- On segment boundary inside the window: broadcast SSE `nowPlaying`, increment `state.playhead.segmentId`.

**`stream/index.ts`**
- Replace `/stream` route with:
  - `GET /live.m3u8` → returns `currentPlaylist()`, `content-type: application/vnd.apple.mpegurl`, `cache-control: no-cache`.
  - `GET /hls/seg-NNNNN/chunk-XXX.ts` → static file from `/data/hls/...`. Use `Bun.file()`, set `content-type: video/mp2t`, long cache (chunks are immutable).
- Keep `/events` (SSE), `/api/health`.
- Listener tracking moves from "open `/stream` connections" to "playlist fetches in last N seconds" — track by IP+UA hash with a 30s TTL, since HLS clients re-fetch the playlist every few seconds.

### State + GC

- `state.playhead = { segmentId, chunkIndex }`.
- Persist on chunk advance (debounced 2s).
- GC: chunks fall out of the rolling window → safe to delete after grace (60s). Whole `seg-NNNNN/` dir + mp3 + meta gone once last chunk evicted + grace passed.

### Frontend changes

**`client/app/page.tsx`**
- Detect HLS support:
  - `audio.canPlayType('application/vnd.apple.mpegurl')` → native (Safari/iOS).
  - Otherwise → `import('hls.js')`, attach to `<audio>`.
- `NEXT_PUBLIC_STREAM_URL` now points at `…/live.m3u8`.
- hls.js config: `liveSyncDuration: 8`, `lowLatencyMode: false`, `enableWorker: true`. Reconnect on `Hls.Events.ERROR` fatal with `startLoad()`.
- Remove any manual reconnect-on-error logic for the old MP3 stream.

**`client/package.json`** — add `hls.js`.

### Config

`shared/config.ts`:
- `hls.chunkDurationSec: 4`
- `hls.windowSize: 10`
- `hls.targetDuration: 5` (ceil of chunkDuration)

### Migration / rollout order

1. Build slicer (`hls.ts`), test on one existing segment via CLI.
2. Wire into `segment.ts`, regenerate buffer from scratch (delete `/data/segments`, `/data/meta`, `/data/hls`).
3. Build `playlist.ts` rolling window logic + tests against fake clock.
4. Add `/live.m3u8` route alongside old `/stream`. Verify with `ffplay http://…/live.m3u8` and Safari.
5. Update frontend behind a query-string flag (`?hls=1`) for A/B.
6. Cut over `NEXT_PUBLIC_STREAM_URL`, delete `/stream` route + `stream/playback.ts` MP3 path.
7. Drop MP3 storage entirely (optional — keep for debug).

### Edge cases to handle

- **Listeners = 0 freeze**: playlist must keep returning the *same* `#EXT-X-MEDIA-SEQUENCE` and same chunks. Don't rotate. When first listener arrives, resume advancement from current chunk (not jump to live edge).
- **Buffer drain**: if no new segment ready when window needs to advance, hold the current playlist (don't add a chunk that doesn't exist). hls.js will buffer-stall briefly; producer should catch up.
- **Cold start**: until first segment sliced, return 503 on playlist.
- **Listener count**: count unique playlist fetchers in last 20s. Decouples from TCP connection lifetime — much more robust than the current Set-of-Responses count.

### Open items to flag during implementation

- ffmpeg `-segment_time` doesn't guarantee exact 4s on MP3 inputs (waits for frame boundary). Actual chunk durations will be ~3.9–4.1s. Record real durations in meta.
- AAC re-encode adds ~1–2s per minute of audio on the VPS. Acceptable; could later switch producer to render AAC directly from Kokoro WAV and skip the MP3 step.
- iOS Safari sometimes ignores `cache-control: no-cache` on playlists. If we see staleness, add a cache-busting query param on the client's playlist URL (hls.js does this automatically).

---

## Rollout order

**Part 1 first** — ships value immediately, no infra risk, lets us validate the prompt before HLS adds variables.
Then Part 2.
