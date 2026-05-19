import { createHash } from "node:crypto";
import { join, normalize } from "node:path";
import { paths } from "../shared/paths.ts";
import { playlist } from "./playlist.ts";

const port = Number(process.env.PORT ?? 8080);

await playlist.init();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...corsHeaders, ...headers };
}

function listenerId(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]!.trim() || "unknown";
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha1").update(`${ip}\n${ua}`).digest("hex");
}

const CHUNK_RE = /^\/hls\/(seg-\d{5})\/(chunk-\d{3}\.ts)$/;

const server = Bun.serve({
  port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      const bufferAheadSec = await playlist.bufferedSecondsAhead();
      return Response.json(
        {
          ok: true,
          listeners: playlist.listenerCount(),
          hasSegments: playlist.hasPlaylist(),
          bufferAheadSec,
          playhead: playlist.playhead(),
        },
        { headers: corsHeaders },
      );
    }

    if (url.pathname === "/live.m3u8") {
      if (!playlist.hasPlaylist()) {
        return new Response("no segments yet", {
          status: 503,
          headers: corsHeaders,
        });
      }
      playlist.touchListener(listenerId(req));
      const body = playlist.renderPlaylist();
      return new Response(body, {
        headers: withCors({
          "content-type": "application/vnd.apple.mpegurl",
          "cache-control": "no-cache",
        }),
      });
    }

    const chunkMatch = CHUNK_RE.exec(url.pathname);
    if (chunkMatch) {
      playlist.touchListener(listenerId(req));
      const [, segName, chunkName] = chunkMatch;
      const full = normalize(join(paths.hls, segName!, chunkName!));
      if (!full.startsWith(paths.hls)) {
        return new Response("forbidden", { status: 403, headers: corsHeaders });
      }
      const file = Bun.file(full);
      if (!(await file.exists())) {
        return new Response("not found", { status: 404, headers: corsHeaders });
      }
      return new Response(file, {
        headers: withCors({
          "content-type": "video/mp2t",
          "cache-control": "public, max-age=31536000, immutable",
        }),
      });
    }

    if (url.pathname === "/events") {
      let sub: ReturnType<typeof playlist.addSse> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sub = playlist.addSse(controller);
        },
        cancel() {
          if (sub) playlist.removeSse(sub);
        },
      });
      req.signal.addEventListener("abort", () => {
        if (sub) playlist.removeSse(sub);
      });
      return new Response(stream, {
        headers: withCors({
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        }),
      });
    }

    return new Response("not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`stream up on :${server.port}`);
console.log(`data dir: ${paths.data}`);
