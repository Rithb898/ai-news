"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";

const STREAM_BASE =
  process.env.NEXT_PUBLIC_STREAM_URL ?? "http://localhost:8080";
const PLAYLIST_URL = `${STREAM_BASE}/live.m3u8`;

type SegmentMeta = {
  segmentId: number;
  title: string;
  source: string;
  url: string;
  durationSec: number;
  scriptText: string;
  generatedAt: string;
};

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [nowPlaying, setNowPlaying] = useState<SegmentMeta | null>(null);
  const [history, setHistory] = useState<SegmentMeta[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  // Warmup: poll /api/health until segments exist.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      try {
        const r = await fetch(`${STREAM_BASE}/api/health`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        setReady(Boolean(j.hasSegments));
        if (!j.hasSegments) timer = setTimeout(check, 5000);
      } catch {
        if (cancelled) return;
        setReady(false);
        timer = setTimeout(check, 5000);
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // SSE with auto-reconnect.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource(`${STREAM_BASE}/events`);
      es.addEventListener("nowPlaying", (e) => {
        try {
          setNowPlaying(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
      es.addEventListener("listeners", (e) => {
        try {
          setListeners(JSON.parse((e as MessageEvent).data).count ?? 0);
        } catch {}
      });
      es.addEventListener("history", (e) => {
        try {
          setHistory(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  const teardownHls = () => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
  };

  const attach = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.canPlayType("application/vnd.apple.mpegurl")) {
      a.src = PLAYLIST_URL;
      return;
    }
    const { default: HlsCtor } = await import("hls.js");
    if (!HlsCtor.isSupported()) {
      a.src = PLAYLIST_URL; // last-ditch
      return;
    }
    teardownHls();
    const hls = new HlsCtor({
      liveSyncDuration: 8,
      lowLatencyMode: false,
      enableWorker: true,
    });
    hlsRef.current = hls;
    hls.on(HlsCtor.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); } catch {}
      } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch {}
      } else {
        try { hls.destroy(); } catch {}
      }
    });
    hls.loadSource(PLAYLIST_URL);
    hls.attachMedia(a);
  };

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      teardownHls();
    } else {
      await attach();
      void a.play().catch(() => setPlaying(false));
    }
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      teardownHls();
    };
  }, []);

  return (
    <main className="relative flex flex-1 flex-col items-center px-4 py-8 sm:py-12 bg-black text-zinc-100">
      <div className="absolute top-4 right-4 flex items-center gap-2 text-sm text-zinc-400">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        {listeners} listening
      </div>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        AI News Radio
      </h1>
      <p className="text-sm text-zinc-500">24/7 AI-hosted</p>

      {ready === false ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
          <p className="text-zinc-400">Warming up the studio…</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="mt-10 flex h-28 w-28 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-100 transition hover:bg-zinc-800 active:scale-95 sm:h-32 sm:w-32"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-12 w-12 fill-current">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-12 w-12 fill-current">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <section className="mt-10 w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Now playing
            </div>
            {nowPlaying ? (
              <>
                <div className="mt-1 text-lg font-medium leading-snug">
                  {nowPlaying.title}
                </div>
                <div className="mt-2 flex items-center gap-3 text-sm text-zinc-400">
                  <span>{nowPlaying.source}</span>
                  {nowPlaying.url && (
                    <a
                      href={nowPlaying.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-300 underline-offset-2 hover:underline"
                    >
                      read original →
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-1 text-zinc-500">—</div>
            )}
          </section>

          <section className="mt-6 w-full max-w-xl">
            <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
              Recently played
            </div>
            <ul className="divide-y divide-zinc-900 rounded-2xl border border-zinc-800 bg-zinc-950">
              {history.length === 0 ? (
                <li className="px-4 py-3 text-sm text-zinc-500">
                  Nothing yet.
                </li>
              ) : (
                [...history].reverse().map((h) => (
                  <li
                    key={h.segmentId}
                    className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <span className="line-clamp-2 text-zinc-200">{h.title}</span>
                    <span className="shrink-0 text-zinc-500">{h.source}</span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}

      <audio ref={audioRef} preload="none" className="hidden" />
    </main>
  );
}
