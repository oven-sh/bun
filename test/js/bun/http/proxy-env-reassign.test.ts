/**
 * Stress test for the env-derived proxy URL lifecycle: getHttpProxy() returns a
 * URL whose fields borrow from a RefCountedEnvValue's bytes. Reassigning
 * process.env.HTTP_PROXY derefs/frees those bytes. Any async caller that stored
 * the borrowed URL would then read freed memory; if the freed block is reused
 * for heap metadata, a later realloc segfaults at NULL (observed in
 * WebSocketUpgradeClient.buildRequestBody → _mi_heap_realloc_zero @ 0x0).
 *
 * FetchTasklet already dupes into url_proxy_buffer; this test guards that
 * behavior end-to-end and exercises the WebSocket-from-socket-callback
 * realloc path under the same heap pressure.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("fetch through env HTTP_PROXY survives mid-flight reassignment, then WebSocket allocPrint does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import net from "node:net";

        // Target HTTP+WS server.
        let httpHits = 0;
        using server = Bun.serve({
          port: 0,
          fetch(req, srv) {
            if (srv.upgrade(req)) return;
            httpHits++;
            return new Response("ok");
          },
          websocket: {
            open(ws) { ws.send("connected"); },
            message(ws, m) { ws.send(m); },
          },
        });
        const targetUrl = "http://127.0.0.1:" + server.port + "/";
        const wsUrl = "ws://127.0.0.1:" + server.port + "/";

        // Minimal forwarding HTTP proxy that handles both absolute-URI GET
        // (fetch over plain HTTP) and CONNECT (WebSocket).
        let proxyHttpHits = 0;
        let proxyConnectHits = 0;
        const proxy = net.createServer(client => {
          let buf = Buffer.alloc(0);
          client.once("data", data => {
            buf = Buffer.concat([buf, data]);
            const text = buf.toString();
            const eoh = text.indexOf("\\r\\n\\r\\n");
            const firstLine = text.slice(0, text.indexOf("\\r\\n"));
            const [method, target, ver] = firstLine.split(" ");
            if (method === "CONNECT") {
              proxyConnectHits++;
              const [host, port] = target.split(":");
              const upstream = net.connect(+port, host, () => {
                client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
                const rest = buf.subarray(eoh + 4);
                if (rest.length) upstream.write(rest);
                client.pipe(upstream);
                upstream.pipe(client);
              });
              upstream.on("error", () => client.destroy());
              return;
            }
            proxyHttpHits++;
            const u = new URL(target);
            const upstream = net.connect(+u.port, u.hostname, () => {
              upstream.write(method + " " + (u.pathname || "/") + (u.search || "") + " " + ver + "\\r\\n");
              upstream.write(text.slice(text.indexOf("\\r\\n") + 2));
              client.pipe(upstream);
              upstream.pipe(client);
            });
            upstream.on("error", () => client.destroy());
          });
        });
        await new Promise(r => proxy.listen(0, "127.0.0.1", r));
        const proxyPort = proxy.address().port;
        const proxyUrl = "http://127.0.0.1:" + proxyPort;

        // TCP echo server so we can run code inside a Bun.connect data callback
        // (the exact reentrancy from the crash report's stack trace).
        const echo = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { data(s, d) { s.write(d); } },
        });

        process.env.HTTP_PROXY = proxyUrl;

        // Fire fetches that resolve their proxy from env (not the explicit
        // {proxy} option). FetchTasklet dupes the env URL before queuing on
        // the HTTP thread; the thrash below would UAF if it didn't.
        const FETCHES = 24;
        const fetches = Array.from({ length: FETCHES }, () => fetch(targetUrl).then(r => r.text()));

        // Thrash HTTP_PROXY so the original RefCountedEnvValue is freed and
        // its bytes reused before the HTTP thread reads them.
        for (let i = 0; i < 128; i++) {
          process.env.HTTP_PROXY = "http://" + Buffer.alloc(32 + (i & 31), "z").toString() + ".invalid:1/";
        }
        Bun.gc(true);
        process.env.HTTP_PROXY = proxyUrl;

        // Now create WebSockets through the proxy from inside a Bun.connect
        // data callback — buildRequestBody runs allocPrint on vm.allocator.
        const wsResults = [];
        for (let i = 0; i < 4; i++) {
          const created = Promise.withResolvers();
          wsResults.push(created.promise);
          Bun.connect({
            hostname: "127.0.0.1",
            port: echo.port,
            socket: {
              open(s) { s.write("ping"); },
              data(s) {
                try {
                  const ws = new WebSocket(wsUrl, { proxy: proxyUrl });
                  ws.onmessage = ev => { if (ev.data === "connected") { ws.close(); created.resolve("ok"); } };
                  ws.onerror = ev => created.reject(new Error("ws error: " + (ev.message ?? ev.type)));
                } catch (e) { created.reject(e); }
                s.end();
              },
              error(_s, e) { created.reject(e); },
            },
          }).catch(e => created.reject(e));
        }

        const fr = await Promise.all(fetches);
        const wr = await Promise.all(wsResults);

        echo.stop(true);
        proxy.close();

        if (fr.some(t => t !== "ok")) { console.error("fetch body mismatch"); process.exit(1); }
        if (wr.some(t => t !== "ok")) { console.error("ws result mismatch"); process.exit(1); }
        if (httpHits < FETCHES) { console.error("endpoint missed fetches: " + httpHits); process.exit(1); }
        if (proxyHttpHits < FETCHES) { console.error("proxy missed fetches: " + proxyHttpHits); process.exit(1); }
        if (proxyConnectHits < 4) { console.error("proxy missed CONNECTs: " + proxyConnectHits); process.exit(1); }

        console.log("PASS " + httpHits + " " + proxyHttpHits + " " + proxyConnectHits);
        process.exit(0);
      `,
    ],
    env: (() => {
      const e: Record<string, string | undefined> = { ...bunEnv };
      delete e.HTTP_PROXY;
      delete e.http_proxy;
      delete e.HTTPS_PROXY;
      delete e.https_proxy;
      delete e.NO_PROXY;
      delete e.no_proxy;
      return e;
    })(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toMatch(/^PASS \d+ \d+ \d+\n$/);
  expect(exitCode).toBe(0);
});
