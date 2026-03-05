// Regression test: segfault at 0x0 in create_ssl_context_from_bun_options during
// proxy tunnel setup.
//
// Root cause: SSLConfig.GlobalRegistry is a weak dedup cache but did not hold a
// strong ref on its entries. When the last external holder deref'd a config
// (HTTP thread) while a new fetch() with identical tls options interned the same
// content (JS thread), intern() could return a pointer whose refcount had already
// hit 0. The returned pointer was then destroyed concurrently, and the proxy
// tunnel later dereferenced freed cert/key memory -> strlen(NULL) -> segfault.
//
// Fix: SSLConfig now uses split strong/weak refcounting (Arc/Weak). The
// registry holds a WEAK ref on each entry. intern() calls upgrade() — a CAS
// loop that only bumps strong if currently > 0 — so it never resurrects a
// dying object. If upgrade fails, the slot is replaced in-place and the dying
// config's remove() no-ops on pointer-identity mismatch.
//
// This test stresses the intern/deref race by firing overlapping waves of proxy
// requests with identical tls options. Each completing request derefs the
// config; each starting request interns an identical one.

import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";

async function createConnectProxy() {
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);

      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort.lastIndexOf(":");
      const host = hostPort.slice(0, colon);
      const port = Number(hostPort.slice(colon + 1));

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

test("concurrent proxy fetches with identical tls options do not race SSLConfig intern/deref", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const proxy = await createConnectProxy();
  const target = `https://127.0.0.1:${backend.port}/`;

  // The tls option object is rebuilt on every fetch call, so each call allocates
  // a fresh SSLConfig and hits GlobalRegistry.intern(). Identical content means
  // they all dedup to the same registry entry.
  // keepalive:false forces each request to drop its ref immediately on
  // completion instead of parking the socket in the keepalive pool (which
  // would hold an extra ref and mask the race).
  const makeRequest = () =>
    fetch(target, {
      proxy: proxy.url,
      keepalive: false,
      tls: {
        ca: tlsCert.cert,
        rejectUnauthorized: false,
      },
    }).then(r => r.text());

  try {
    // Prime the registry so subsequent waves hit the found_existing path.
    expect(await makeRequest()).toBe("ok");

    // Fire overlapping waves: start a new wave while the previous is still
    // settling. This maximises the window where one request's deref races a
    // new request's intern().
    const concurrency = 8;
    const waves = 6;
    let inFlight: Promise<string[]> = Promise.resolve([]);
    for (let w = 0; w < waves; w++) {
      const prev = inFlight;
      inFlight = Promise.all(Array.from({ length: concurrency }, makeRequest));
      const results = await prev;
      for (const r of results) expect(r).toBe("ok");
    }
    const last = await inFlight;
    for (const r of last) expect(r).toBe("ok");
  } finally {
    proxy.server.close();
    await once(proxy.server, "close");
  }
});
