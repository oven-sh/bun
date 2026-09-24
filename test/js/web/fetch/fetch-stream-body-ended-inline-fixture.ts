// Regression: fetch() with a native ByteStream request body (an upstream
// Response body piped straight into fetch) whose stream errors or finishes
// between queueing the request and the can_stream tick. wire_native_sink then
// reports EndedInline, which released the request-stream ref but left the
// sink installed as a live native sink; the terminal cancel_request_body_sink
// released the same ref again, freeing the FetchTasklet while still in use.
//
// The upstream server advertises a bigger content-length than it sends and
// closes a few ms later, so the client-side ByteStream picks up a pending
// error in exactly that window. The downstream fetch goes over TLS so the
// handshake keeps the window open. One poisoned iteration is enough to
// crash an ASAN build at the double release.
import { tls } from "harness";

const upstream = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open() {},
    data(sock) {
      sock.write(
        "HTTP/1.1 200 OK\r\ncontent-length: 1000\r\nconnection: close\r\n\r\npartial-body",
      );
      const delay = 1 + Math.floor(Math.random() * 8);
      setTimeout(() => {
        try {
          sock.end();
        } catch {}
      }, delay);
    },
  },
});

await using postServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls,
  async fetch(req) {
    await req.arrayBuffer().catch(() => {});
    return new Response("ok");
  },
});

const upBase = `http://127.0.0.1:${upstream.port}`;
const postBase = `https://localhost:${postServer.port}`;
const iterations = Number(process.env.ITER || "100");

for (let i = 0; i < iterations; i++) {
  try {
    const upRes = await fetch(upBase);
    const res = await fetch(postBase, {
      method: "POST",
      body: upRes.body,
      tls: { ca: tls.cert },
    });
    await res.text();
  } catch {
    // Upstream truncation makes some downstream fetches reject; that's the
    // expected error path. Only a crash is a failure.
  }
  if (i % 25 === 0) Bun.gc(false);
}

upstream.stop(true);
console.log(`done ${iterations}`);
