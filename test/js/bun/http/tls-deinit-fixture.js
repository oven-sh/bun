// Fixture for testing HTTPContext.deinit() with live keepalive sockets.
// When the process exits, HTTPContext is torn down. If sockets are still in
// the keepalive pool, the old single-call deinit() could fire callbacks on
// partially-freed memory (UAF). The 3-step fix (cleanCallbacks → close → free)
// prevents this. If the bug is present, this will crash/segfault.

const cert = process.env.TLS_CERT;
const key = process.env.TLS_KEY;

if (!cert || !key) {
  throw new Error("TLS_CERT and TLS_KEY env vars required");
}

using server = Bun.serve({
  port: 0,
  tls: { cert, key },
  hostname: "127.0.0.1",
  fetch() {
    return new Response("ok");
  },
});

const url = `https://127.0.0.1:${server.port}`;

// Make requests with keepalive enabled so sockets stay pooled after completion.
for (let i = 0; i < 10; i++) {
  const res = await fetch(url, {
    tls: { rejectUnauthorized: false },
    keepalive: true,
  });
  await res.text();
}

// Exit immediately while keepalive sockets are still pooled.
// This triggers HTTPContext.deinit() with live sockets.
console.log("OK");
