// Regression test: SSLConfig intern/deref race causing segfault in proxy tunnel
// See: https://github.com/oven-sh/bun/pull/27838
//
// The race: when the last strong ref on an interned SSLConfig is dropped on the
// HTTP thread, destroy() runs. Before it can remove the dying entry from the
// registry, the JS thread can call intern(), find it (refcount=0), bump 0→1,
// and return a pointer that destroy() is about to free. The proxy tunnel later
// reads freed memory → segfault at address 0x0 (strlen(NULL) in openssl.c).
//
// Without `ca` set, requires_custom_request_ctx=false, so the SSL context cache
// does NOT hold an extra ref — the only ref is the HTTPClient's. This means
// the refcount hits 0 on every request completion.
//
// HOW TO VERIFY:
//   BUN_DEBUG_SSLConfig=1 bun bd test test/js/web/fetch/fetch-proxy-tls-intern-race.test.ts
//
// On unfixed code: look for "intern: found existing 0x..., refcount=0 before ref"
//   → That's the 0→1 resurrection bug. In debug builds, debugAssert panics.
//   → In release/ASAN builds, this is a UAF that ASAN should catch.
//
// On fixed code (Arc/Weak): look for "upgrade FAILED" log
//   → That's the fix catching and handling the race safely.
//   → "destroy"/"dropContents" logs confirm refcount reaches 0.

import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";

async function createConnectProxy() {
  const server = net.createServer((client) => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);

      const firstLine = head
        .subarray(0, head.indexOf("\r\n"))
        .toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort!.lastIndexOf(":");
      const host = hostPort!.slice(0, colon);
      const port = Number(hostPort!.slice(colon + 1));

      const upstream = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const extra = head.subarray(headerEnd + 4);
        if (extra.length > 0) upstream.write(extra);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

test("SSLConfig intern/deref race does not cause use-after-free", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const proxy = await createConnectProxy();
  const target = `https://127.0.0.1:${backend.port}/`;

  const makeRequest = () =>
    fetch(target, {
      proxy: proxy.url,
      keepalive: false,
      // No `ca` → requires_custom_request_ctx=false → no SSL ctx cache ref
      // → only HTTPClient holds a ref → deref goes 1→0 on completion.
      tls: { rejectUnauthorized: false },
    }).then((r) => r.text());

  // Fire many concurrent requests in waves. Each wave's requests share the
  // same interned config. When a wave completes, refcount drops to 0 →
  // destroy(). The next wave's intern() may find the dying entry.
  const WAVES = 10;
  const PER_WAVE = 16;

  for (let wave = 0; wave < WAVES; wave++) {
    const results = await Promise.all(
      Array.from({ length: PER_WAVE }, () =>
        makeRequest().catch((e: Error) => `ERR:${e.message}`)
      )
    );
    for (const r of results) {
      expect(r).toBe("ok");
    }
  }

  proxy.server.close();
});
