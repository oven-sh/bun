// Regression test for https://github.com/oven-sh/bun/issues/30381
//
// When fetch() goes through an HTTP CONNECT proxy to an `https://` target
// and the proxy's `HTTP/1.1 200 Connection established` envelope is delivered
// across multiple TCP reads, Bun's fetch client used to:
//
//   1. Leak the CONNECT envelope headers (`proxy-agent`, `connection: close`)
//      into `response.headers` instead of the upstream's real headers.
//   2. Dump the upstream's raw `HTTP/1.1 200 OK\r\n…` envelope, chunked size
//      prefixes (`1b\r\n`), and the chunked terminator (`0\r\n\r\n`) into
//      `response.body` as unparsed bytes.
//   3. Hang forever (or until TCP FIN) because the chunked terminator was
//      never recognized — a spec-compliant keep-alive upstream that doesn't
//      promptly FIN would deadlock the stream.
//
// Root cause: `handle_short_read` stashed partial envelope bytes into
// `state.response_message_buffer` and `handle_on_data_headers` re-entered
// from `ProxyTunnel`'s `on_data` with `response_stage == proxy_headers`,
// appending decrypted upstream bytes onto the stale envelope and re-parsing
// it as the user-facing response. The fix (`src/http/lib.rs`,
// `start_proxy_handshake`) `std::mem::take`s the buffer into a local before
// `ProxyTunnel::start` and drops it after the TLS BIO has copied any
// trailing payload.
//
// A CONNECT response that arrives in one TCP read does NOT trigger the bug —
// the buffer stays empty on the first parse. This test forces two separate
// reads by enabling TCP_NODELAY and pausing between the two writes with a
// `Bun.sleep(5)` yield so the kernel flushes the first segment and the
// fetch client's HTTP thread consumes it before the second segment lands.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";

// Give the subprocess headroom on slow ASAN CI machines — the combined
// setup (Bun.serve TLS + net.createServer + fetch TLS handshake) runs
// ~2.3s on a loaded ASAN debug build locally, which leaves very little
// margin under bun:test's default 5s timeout on a contended CI runner.
test("fetch through CONNECT proxy with split 200 envelope surfaces upstream response (#30381)", async () => {
  // Subprocess so we can strip NO_PROXY/no_proxy from the environment.
  // CI and dev environments commonly set NO_PROXY to cover loopback
  // (localhost, 127.0.0.1), which would cause the explicit `proxy:`
  // option to be silently bypassed and the test to exercise a direct
  // fetch instead of the CONNECT tunnel.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import net from "node:net";
        const tlsCert = ${JSON.stringify(tlsCert)};

        using upstream = Bun.serve({
          port: 0,
          tls: tlsCert,
          hostname: "127.0.0.1",
          async fetch() {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("hello "));
                  controller.enqueue(new TextEncoder().encode("world"));
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "text/event-stream",
                  "x-upstream-marker": "from-upstream",
                },
              },
            );
          },
        });
        const upstreamPort = upstream.port;

        const proxy = net.createServer(client => {
          let reqBuf = Buffer.alloc(0);
          client.on("data", chunk => {
            reqBuf = Buffer.concat([reqBuf, chunk]);
            if (!reqBuf.includes("\\r\\n\\r\\n")) return;
            const first = reqBuf.toString("latin1").split("\\r\\n", 1)[0];
            if (!first.startsWith("CONNECT ")) {
              client.end("HTTP/1.1 400 Bad Request\\r\\n\\r\\n");
              return;
            }
            const upstreamSock = net.connect(upstreamPort, "127.0.0.1", async () => {
              // Force handle_short_read on the client by making the CONNECT
              // 200 envelope arrive across two separate on_data() calls in
              // the fetch client. Nagle + TCP coalescence would otherwise
              // batch back-to-back writes into one segment. Disable Nagle
              // and yield between writes — the yield gives the kernel time
              // to flush the first segment and the fetch client's HTTP
              // thread time to consume it before the second segment lands
              // in the receive buffer.
              client.setNoDelay(true);
              const envelope = Buffer.from(
                "HTTP/1.1 200 Connection established\\r\\nConnection: close\\r\\nProxy-Agent: splitproxy\\r\\n\\r\\n",
              );
              client.write(envelope.subarray(0, 20));
              // Yield via the OS timer queue so the fetch client (running
              // on the HTTP thread, not the JS event loop) observes the
              // first packet as an independent read. Bun.sleep(5) bounces
              // through the kernel scheduler — the only mechanism that
              // lets a cross-thread consumer make progress under ASAN CI
              // load. A microtask yield like Bun.sleep(0) or
              // Promise.resolve() only drains THIS thread's queue and
              // wouldn't help.
              await Bun.sleep(5);
              client.write(envelope.subarray(20));
              client.pipe(upstreamSock);
              upstreamSock.pipe(client);
            });
            upstreamSock.on("error", () => client.destroy());
            client.on("error", () => upstreamSock.destroy());
            client.removeAllListeners("data");
          });
        });
        await new Promise(r => proxy.listen(0, "127.0.0.1", r));
        const proxyUrl = "http://127.0.0.1:" + proxy.address().port;

        const response = await fetch("https://127.0.0.1:" + upstreamPort + "/", {
          proxy: proxyUrl,
          tls: { rejectUnauthorized: false },
          keepalive: false,
        });

        const body = await response.text();
        proxy.close();

        const result = {
          status: response.status,
          marker: response.headers.get("x-upstream-marker"),
          contentType: response.headers.get("content-type"),
          proxyAgent: response.headers.get("proxy-agent"),
          body,
        };
        console.log(JSON.stringify(result));
        process.exit(0);
      `,
    ],
    env: (() => {
      const e = { ...bunEnv };
      delete e.NO_PROXY;
      delete e.no_proxy;
      delete e.HTTP_PROXY;
      delete e.http_proxy;
      delete e.HTTPS_PROXY;
      delete e.https_proxy;
      return e;
    })(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error("stderr:", stderr, "stdout:", stdout);

  // Before the fix, this assertion failed in three ways:
  //   - `marker` and `contentType` were null (CONNECT envelope leaked as
  //     user-facing headers; upstream's real headers never surfaced).
  //   - `proxyAgent` was "splitproxy" (leaked from CONNECT envelope).
  //   - `body` either contained raw "HTTP/1.1 200 OK\r\n..." + "6\r\nhello
  //     \r\n5\r\nworld\r\n0\r\n\r\n" (unparsed envelope + chunked framing),
  //     or the subprocess hit the 20s timeout (chunked terminator never
  //     recognized; keep-alive server held the socket open).
  // Assert stdout before exit code so failures show the response payload.
  expect(JSON.parse(stdout.trim())).toEqual({
    status: 200,
    marker: "from-upstream",
    contentType: "text/event-stream",
    proxyAgent: null,
    body: "hello world",
  });
  expect(exitCode).toBe(0);
}, 30_000);
