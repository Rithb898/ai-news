const port = Number(process.env.PORT ?? 8080);

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`stream up on :${server.port}`);
