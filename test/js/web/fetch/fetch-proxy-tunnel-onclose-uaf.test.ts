// Regression test: ProxyTunnel SSLWrapper callbacks firing with a stale
// *HTTPClient ctx after the request completed and the tunnel was pooled/
// detached inside the same handleReading() call.
//
// Sequence: onData → triggerDataCallback → response completes → HTTPClient
// freed → SSL_read returns close_notify/error → triggerCloseCallback →
// onClose(freed ptr) → use-after-poison.
//
// The backend responds with Connection: close so the response body and the
// TLS close_notify tend to arrive in the same TCP segment, landing both in
// one receive() → handleReading() call.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";

async function createConnectProxy() {
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    let upstream: net.Socket | undefined;
    client.on("error", () => upstream?.destroy());
    client.on("close", () => upstream?.destroy());
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);
      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort!.lastIndexOf(":");
      const host = hostPort!.slice(0, colon);
      const port = Number(hostPort!.slice(colon + 1));
      upstream = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const extra = head.subarray(headerEnd + 4);
        if (extra.length > 0) upstream!.write(extra);
        client.pipe(upstream!);
        upstream!.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.destroy());
    };
    client.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

test("ProxyTunnel onClose does not use freed HTTPClient after response completes", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok", { headers: { Connection: "close" } });
    },
  });

  const proxy = await createConnectProxy();

  const fixture = `
    const backend = process.env.BACKEND_URL;
    const proxy = process.env.PROXY_URL;
    let ok = 0;
    for (let round = 0; round < 5; round++) {
      const batch = [];
      for (let i = 0; i < 64; i++) {
        batch.push(
          fetch(backend, { proxy, tls: { rejectUnauthorized: false } })
            .then(r => r.text())
            .then(() => { ok++; })
            .catch(() => {}),
        );
      }
      await Promise.all(batch);
    }
    console.log(JSON.stringify({ ok }));
  `;

  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        BACKEND_URL: String(backend.url),
        PROXY_URL: `http://127.0.0.1:${proxy.port}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.error("Fixture stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    const lines = stdout.trim().split("\n");
    const result = JSON.parse(lines[lines.length - 1]);
    expect(result.ok).toBeGreaterThan(0);
  } finally {
    proxy.server.close();
    proxy.server.unref();
  }
});
