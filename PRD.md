# AI News Radio — PRD

A 24/7 AI-hosted news radio. Two-host podcast-style dialogue covers AI news pulled from RSS. Shared live stream with pause/resume when nobody's listening.

## Stack

- **Backend**: Bun (two processes: producer + stream). TypeScript.
- **Frontend**: Next.js + Tailwind. Single page.
- **TTS**: Kokoro JS (local, ONNX). Voices: `af_bella` (HOST_A), `am_michael` (HOST_B).
- **LLM**: OpenAI `gpt-5.4-mini`, structured JSON output.
- **Audio**: ffmpeg for MP3 encode + concat.
- **Storage**: filesystem-only. Shared Docker volume `/data`.
- **Deploy**: 3 Docker containers (producer, stream, web) via Coolify on Oracle VPS.

## Filesystem contract (`/data`)

```
segments/seg-NNNNN.mp3     # encoded segment
meta/seg-NNNNN.json        # { title, source, url, durationSec, scriptText, generatedAt }
state.json                 # { playhead: {segmentId, byteOffset}, airedFingerprints: [...] }
logs/{producer,stream}.log
scripts/                   # raw GPT JSON dumps (debug)
```

---

## Phase 0 — Project scaffolding

**Goal**: repo layout + dev runnable.

- [ ] Restructure `server/` to `server/src/{producer,stream,shared}/`.
- [ ] `shared/config.ts` (RSS list, voices, target buffer min, segment word target, paths).
- [ ] `shared/paths.ts` (resolves `/data/segments/...`, etc.; configurable via env `DATA_DIR`).
- [ ] `shared/types.ts` (`SegmentMeta`, `Turn`, `State`).
- [ ] `.env.example` with `OPENAI_API_KEY`, `DATA_DIR`.
- [ ] Producer stub (`producer/index.ts`) — prints "producer up".
- [ ] Stream stub (`stream/index.ts`) — `Bun.serve` returning `/health`.
- [ ] Client: strip Next.js boilerplate to a single dark `page.tsx` with placeholder play button.

**Done when**: `bun run server/src/producer/index.ts`, `bun run server/src/stream/index.ts`, and `bun --cwd client dev` all run cleanly.

---

## Phase 1 — Script generation pipeline

**Goal**: given an article, produce a parsed dialogue JSON.

- [x] RSS fetcher: pulls all feeds in `config.rssFeeds`, returns normalized `{title, summary, url, source, publishedAt}`.
- [x] Dedup: normalize title → token Jaccard against `state.airedFingerprints` (threshold 0.6).
- [x] OpenAI client wrapper with structured-output JSON schema (`turns: [{speaker, text}]`).
- [x] System prompt (cached) + per-article user prompt.
- [x] Validates: 8–12 turns, alternating-ish speakers, total ~180 words.
- [x] CLI: `bun run server/src/producer/test-script.ts <rss-item-index>` → prints dialogue.

**Done when**: dialogue JSON is reliably parseable, sounds conversational, ~180 words.

---

## Phase 2 — TTS + segment encoding

**Goal**: dialogue JSON → finished MP3 on disk.

- [x] Integrate `kokoro-js` (or transformers.js + Kokoro ONNX). Confirm ARM64 inference works on Oracle VPS.
- [x] Per-turn TTS: render WAV per turn with assigned voice.
- [x] Concatenate WAVs with ~200ms silence between turns.
- [x] ffmpeg encode → `seg-NNNNN.mp3` (constant bitrate, 128kbps, mono).
- [x] Write `meta/seg-NNNNN.json` with title/source/url/duration.
- [x] Atomic write (write to `.tmp`, rename) so stream never reads a half-written file.

**Done when**: end-to-end CLI command takes one RSS item → produces a playable MP3 + meta file.

---

## Phase 3 — Producer loop

**Goal**: continuous, self-healing segment generation.

- [x] Main loop: compute `bufferedSecondsAhead = sum(meta.duration for unplayed segments)`. If < 30 min, generate next; else sleep 30s.
- [x] Pick next article: freshest non-aired RSS item; if none, draw from `config.evergreenTopics`.
- [x] On generation success: append fingerprint to `state.airedFingerprints` (cap last 7 days), increment segment counter.
- [x] On failure: retry 3x with exponential backoff (1s, 4s, 16s) per stage (LLM, TTS, ffmpeg). Skip item + log if all fail.
- [x] Garbage collect: delete segments + meta after they're past `state.playhead.segmentId` by ≥ 10 minutes.

**Done when**: producer runs unsupervised for an hour, buffer stays around 30 min, failures are logged not fatal.

---

## Phase 4 — Stream server

**Goal**: serve continuous MP3 + SSE to listeners with shared playhead.

- [x] `GET /stream`:
  - Track connection in `Set<Response>`.
  - If 0 segments exist, return 503.
  - Send MP3 bytes from `state.playhead` position, advancing playhead **only when `connections.size > 0`**.
  - On segment end: increment `segmentId`, reset `byteOffset`, broadcast SSE `nowPlaying`.
  - Persist `state.playhead` to disk every ~2s (debounced).
- [x] `GET /events` (SSE):
  - On connect: send `nowPlaying` (current) + `listeners` (count) + `history` (last 20).
  - Broadcast `nowPlaying` on segment boundary, `listeners` on connect/disconnect.
- [x] `GET /api/health`: process + buffer-ahead + listener count.
- [x] Stale-playhead handling on boot: if next segment's `generatedAt` > 24h old, fast-forward through stale segments (delete them).
- [x] If buffer fully drains (no next segment): close all active `/stream` connections with 503.

**Done when**: `curl https://api.../stream | ffplay -` plays continuous audio, two `curl`s hear identical bytes, closing all clients freezes the playhead.

---

## Phase 5 — Frontend

**Goal**: the listener page.

- [x] Single `page.tsx`, dark theme, mobile-first.
- [x] Big play/pause button → toggles `<audio src={STREAM_URL}>`.
- [x] Now Playing card: title, source, "read original →" link.
- [x] History list: last 20 played items.
- [x] Live listener count top-right.
- [x] SSE client (`EventSource(/events)`) drives all UI state.
- [x] Warmup splash if `/api/health` reports 0 segments.
- [x] Reconnect logic for SSE and `<audio>` `error` events.

**Done when**: page loads on phone + desktop, plays continuous radio, history populates as segments turn over.

---

## Phase 6 — Containerize

**Goal**: deployable image set.

- [ ] `server/Dockerfile` — bun base image, copies src, runs `bun install`. Entrypoint chosen at runtime via `CMD`.
- [ ] `client/Dockerfile` — Next.js standalone output.
- [ ] `docker-compose.yml`:
  - `producer` service → `bun run src/producer/index.ts`, mounts volume.
  - `stream` service → `bun run src/stream/index.ts`, mounts volume, exposes 8080.
  - `web` service → exposes 3000, env `NEXT_PUBLIC_STREAM_URL`.
  - Named volume `radio-data`.
- [ ] ffmpeg in producer image. Kokoro model baked in (or downloaded on first run with cache dir on volume).

**Done when**: `docker compose up` runs all three locally and the page works against `localhost:3000`.

---

## Phase 7 — Deploy via Coolify

- [ ] Push to Git repo.
- [ ] Coolify: new project, point at repo, docker-compose mode.
- [ ] Set `OPENAI_API_KEY` in Coolify env.
- [ ] Domain routing:
  - `radio.yourdomain.com` → `web:3000`.
  - `api.radio.yourdomain.com` → `stream:8080`.
- [ ] Set `NEXT_PUBLIC_STREAM_URL=https://api.radio.yourdomain.com`.
- [ ] CORS on stream server: allow frontend origin.

**Done when**: public URL serves radio over HTTPS to phone + desktop, listener count visible.

---

## Phase 8 — Polish (post-launch)

- [ ] Tune script prompt based on actual listened output.
- [ ] Adjust segment length / pacing if needed.
- [ ] Expand evergreen pool.
- [ ] Add more RSS sources.
- [ ] Consider: small jingle between segments, voice variety, listener-submitted topics (future).

---

## Non-goals (v1)

- Per-user playlists / personalization.
- Live chat or any interactivity.
- Skip / seek controls.
- Music beds under voice.
- Multiple stations.
- Analytics beyond live listener count.
- Authentication.
