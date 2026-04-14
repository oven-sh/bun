// Fixture for wss-proxy-tunnel-leak.test.ts.
// Repeatedly opens+closes a wss:// WebSocket through an HTTP CONNECT proxy
// (the tunnel-mode upgrade path in WebSocketUpgradeClient.zig), then reports
// RSS growth so the test can assert the per-upgrade HTTPClient/tunnel are freed.
// Servers run in a child process so server-side allocations don't pollute the
// client RSS measurement.
import net from "node:net";
import { tls as tlsCerts } from "harness";

if (process.argv[2] === "server") {
  const wss = Bun.serve({
    port: 0,
    tls: { key: tlsCerts.key, cert: tlsCerts.cert },
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("nope", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("hi");
      },
      message(ws, m) {
        ws.send(m);
      },
    },
  });

  const proxy = net.createServer(client => {
    let buf = Buffer.alloc(0);
    const onData = (data: Buffer) => {
      buf = Buffer.concat([buf, data]);
      const text = buf.toString();
      const eoh = text.indexOf("\r\n\r\n");
      if (eoh < 0) return; // wait for more — CONNECT may span multiple reads
      // Removing the only 'data' listener leaves the socket in flowing mode;
      // pause it so any bytes that arrive before pipe() is attached aren't lost.
      client.pause();
      client.removeListener("data", onData);
      const first = text.slice(0, text.indexOf("\r\n"));
      const m = first.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
      if (!m) {
        client.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        client.end();
        return;
      }
      const upstream = net.connect(+m[2], m[1], () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = buf.subarray(eoh + 4);
        if (rest.length) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.destroy());
      client.on("close", () => upstream.destroy());
    };
    client.on("data", onData);
    client.on("error", () => {});
  });
  await new Promise<void>(r => proxy.listen(0, "127.0.0.1", () => r()));

  process.send!({ wss: wss.port, proxy: (proxy.address() as net.AddressInfo).port });
  // Keep alive until parent exits.
  setInterval(() => {}, 1 << 30);
} else {
  const ready = Promise.withResolvers<{ wss: number; proxy: number }>();
  await using child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "server"],
    env: process.env,
    // Don't inherit — keeps server-side noise out of this process's stdio so
    // the parent test only sees the JSON growth report on stdout.
    stdout: "ignore",
    stderr: "ignore",
    ipc(msg) {
      ready.resolve(msg);
    },
  });
  const { wss: wssPort, proxy: proxyPort } = await Promise.race([
    ready.promise,
    child.exited.then(code => Promise.reject(new Error(`server fixture exited before sending ports (code ${code})`))),
  ]);
  const wssUrl = `wss://localhost:${wssPort}/`;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  async function once(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const ws = new WebSocket(wssUrl, {
      // @ts-expect-error Bun-specific options
      proxy: proxyUrl,
      tls: { rejectUnauthorized: false },
    });
    let opened = false;
    ws.onmessage = () => {
      opened = true;
      ws.close();
    };
    ws.onclose = () => {
      if (opened) resolve();
      else reject(new Error("closed before message"));
    };
    ws.onerror = ev => reject(new Error(`ws error: ${(ev as ErrorEvent).message ?? ev.type}`));
    return promise;
  }

  const WARMUP = parseInt(process.env.LEAK_WARMUP ?? "60", 10);
  const ITER = parseInt(process.env.LEAK_ITER ?? "500", 10);
  const BATCH = 8;

  async function loop(n: number) {
    let remaining = n;
    while (remaining > 0) {
      const k = Math.min(BATCH, remaining);
      const batch: Promise<void>[] = [];
      for (let i = 0; i < k; i++) batch.push(once());
      await Promise.all(batch);
      remaining -= k;
    }
  }

  await loop(WARMUP);
  Bun.gc(true);
  const baseline = process.memoryUsage.rss();

  await loop(ITER);
  Bun.gc(true);
  const after = process.memoryUsage.rss();

  console.log(JSON.stringify({ baseline, after, growth: after - baseline, iter: ITER }));
  child.kill();
}
