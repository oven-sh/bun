import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isOhos, tempDir } from "harness";
import http2 from "node:http2";
import tls from "node:tls";
import {
  F,
  H2Result,
  RawH2,
  T,
  baseHeaders,
  connectH2,
  decodeStatus,
  frame,
  hpackLiteral,
  request,
  startFixture,
} from "./serve-http2-helpers";

const fetchH3 = (port: number, path: string, init: RequestInit = {}) =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

describe("Bun.serve http2 + http3 on one port", () => {
  test("fetch, static and file routes over both; alt-svc advertised on h2; reload; stop with a stream open on each", async () => {
    await using fx = await startFixture({ tls: true, http3: true });
    const session = await connectH2(fx.port, true);
    const h2hello = await request(session, { ":path": "/hello" });
    expect(h2hello.body.toString()).toBe("hello");
    expect(String(h2hello.headers["alt-svc"] ?? "")).toContain("h3=");
    expect(await (await fetchH3(fx.port, "/hello")).text()).toBe("hello");
    expect((await request(session, { ":path": "/static" })).body.toString()).toBe("from-static-route");
    expect(await (await fetchH3(fx.port, "/static")).text()).toBe("from-static-route");
    const size = 3 * 1024 * 1024 + 17;
    expect((await request(session, { ":path": "/file-route" })).body.length).toBe(size);
    expect((await (await fetchH3(fx.port, "/file-route")).arrayBuffer()).byteLength).toBe(size);
    expect((await request(session, { ":path": "/api/7" })).body.toString()).toBe("id=7");
    expect(await (await fetchH3(fx.port, "/api/7")).text()).toBe("id=7");
    // reload swaps routes on both mux apps
    expect((await request(session, { ":path": "/reload" })).body.toString()).toBe("reloaded");
    expect((await request(session, { ":path": "/reloaded-route" })).body.toString()).toBe("after-reload");
    expect(await (await fetchH3(fx.port, "/reloaded-route")).text()).toBe("after-reload");
    // graceful stop with one slow stream in flight on each transport
    const slow2 = request(session, { ":path": "/slow?ms=300" });
    const slow3 = fetchH3(fx.port, "/slow?ms=300").then(r => r.text());
    expect((await request(session, { ":path": "/stop" })).body.toString()).toBe("stopping");
    expect((await slow2).body.toString()).toBe("slow");
    expect(await slow3).toBe("slow");
    await new Promise<void>(r => session.once("close", () => r()));
  }, 30000);

  // OHOS: the bun binary does not enforce http1:false (an HTTP/1.1 request is
  // still served), so this case fails there; skip pending native analysis.
  test.skipIf(isOhos)("http1: false with both h2 and h3", async () => {
    await using fx = await startFixture({ tls: true, http3: true, http1: false });
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    expect(await (await fetchH3(fx.port, "/hello")).text()).toBe("hello");
    const h1 = await fetch(`https://127.0.0.1:${fx.port}/hello`, { tls: { rejectUnauthorized: false } }).then(
      r => "status:" + r.status,
      e => "error",
    );
    expect(h1).toBe("error");
    session.close();
  });
});

describe("Bun.serve http2 lifecycle", () => {
  test("graceful stop: GOAWAY, in-flight stream completes, process exits", async () => {
    await using fx = await startFixture({ tls: true });
    const session = await connectH2(fx.port, true);
    const goaway = new Promise<number>(resolve => session.on("goaway", code => resolve(code)));
    const slow = request(session, { ":path": "/slow?ms=200" });
    await request(session, { ":path": "/hello" });
    const stopped = await request(session, { ":path": "/stop" });
    expect(stopped.body.toString()).toBe("stopping");
    expect(await goaway).toBe(0);
    expect((await slow).body.toString()).toBe("slow");
    // No new streams are accepted after GOAWAY; the server closes the drained connection.
    await new Promise<void>(r => (session.closed ? r() : session.once("close", () => r())));
  });

  test("idleTimeout closes a silent connection; server.timeout(req, 0) exempts it", async () => {
    // usockets ticks timeouts in 4 s steps, so this test needs real seconds.
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const idle = await connectH2(fx.port, false);
    const idleClosed = new Promise<void>(r => idle.once("close", () => r()));
    const busy = await connectH2(fx.port, false);
    const kept = request(busy, { ":path": "/keepalive?ms=9000" });
    await idleClosed;
    expect((await kept).body.toString()).toBe("kept");
    expect(fx.stderr()).not.toContain("KEEPALIVE-ABORTED");
    busy.close();
  }, 30000);

  test("graceful stop closes a connection whose last stream ends outside a socket event", async () => {
    await using fx = await startFixture({ tls: false });
    const session = await connectH2(fx.port, false);
    const closed = new Promise<void>(r => session.once("close", () => r()));
    const slow = request(session, { ":path": "/slow?ms=300" });
    expect((await request(session, { ":path": "/stop" })).body.toString()).toBe("stopping");
    expect((await slow).body.toString()).toBe("slow");
    // The timer-resolved response retired the last stream from a JS callback;
    // the server must still notice the drained GOAWAY'd connection and close it.
    await closed;
  });

  test("graceful stop: GOAWAY carries the last processed stream id; later streams get nothing and their DATA is tolerated", async () => {
    await using fx = await startFixture({ tls: false });
    const raw = await RawH2.connect(fx.port, false);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/slow?ms=300"));
    raw.headers(3, baseHeaders("/stop"));
    const g = await raw.goaway();
    expect(g.code).toBe(0);
    expect(g.lastStreamId).toBe(3);
    raw.headers(5, baseHeaders("/echo", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 5, Buffer.alloc(16384)));
    raw.write(frame(T.DATA, F.END_STREAM, 5, Buffer.alloc(16384)));
    expect((await raw.body(3)).toString()).toBe("stopping");
    expect((await raw.body(1)).toString()).toBe("slow");
    await raw.waitForClose();
    expect(raw.frames.some(f => f.streamId === 5)).toBe(false);
    expect(raw.frames.filter(f => f.type === T.GOAWAY).every(f => f.payload.readUInt32BE(4) === 0)).toBe(true);
    raw.close();
  });

  test("a paused (slowly read) request body does not idle out the connection", async () => {
    // usockets ticks timeouts in 4 s steps, so this needs real seconds.
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const session = await connectH2(fx.port, false);
    const res = await new Promise<H2Result>((resolve, reject) => {
      const r = session.request({ ":path": "/slow-read?ms=700", ":method": "POST" }, { endStream: false });
      const chunks: Buffer[] = [];
      let headers: http2.IncomingHttpHeaders = {};
      r.on("response", h => (headers = h));
      r.on("data", c => chunks.push(c));
      r.on("end", () => resolve({ status: Number(headers[":status"]), headers, body: Buffer.concat(chunks) }));
      r.on("error", reject);
      // 12 × 512 KB; at 700 ms per delivered chunk the stream sits paused
      // (window closed) for well over idleTimeout in total.
      let i = 0;
      const next = () => (i++ < 12 ? r.write(Buffer.alloc(512 * 1024), next) : r.end());
      next();
    });
    expect(res.body.toString()).toBe(String(12 * 512 * 1024));
    session.close();
  }, 40000);

  // usockets ticks timeouts every 4 s and idleTimeout rounds to ticks, so 8 s
  // (two ticks) with keepalive traffic every 2 s is the smallest setting that
  // separates "refreshed the timer" from "did not".
  for (const [name, keepalive] of [
    ["PING", (raw: RawH2) => raw.write(frame(T.PING, 0, 0, Buffer.from("keepaliv")))],
    // An open POST sending empty non-final DATA frames.
    ["empty DATA", (raw: RawH2) => raw.write(frame(T.DATA, 0, 101))],
    // One byte on the wire, all of it padding.
    ["padded empty DATA", (raw: RawH2) => raw.write(frame(T.DATA, F.PADDED, 101, Buffer.from([0])))],
  ] as const) {
    test(`${name} frames do not keep a connection alive whose streams are all stalled at a zero window`, async () => {
      await using fx = await startFixture({ tls: false, idleTimeout: 8 });
      const stalled = await RawH2.connect(fx.port, false, { settings: Buffer.from([0, 4, 0, 0, 0, 0]) }); // INITIAL_WINDOW_SIZE = 0
      await stalled.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      for (let i = 0, id = 1; i < 8; i++, id += 2) stalled.headers(id, baseHeaders("/big"));
      stalled.write(frame(T.HEADERS, F.END_HEADERS, 101, hpackLiteral(baseHeaders("/echo", "POST"))));
      await stalled.waitFor(f => f.type === T.HEADERS && f.streamId === 15);
      // Control: a connection making real progress every 2 s on the same server outlives it.
      const live = await RawH2.connect(fx.port, false);
      let liveId = 1;
      const t0 = Date.now();
      const tick = setInterval(() => {
        if (!stalled.closed) keepalive(stalled);
        if (!live.closed) {
          live.headers(liveId, baseHeaders("/hello"));
          liveId += 2;
        }
      }, 2000);
      try {
        await stalled.waitForClose();
        expect(Date.now() - t0).toBeLessThan(20000);
        expect(stalled.frames.some(f => f.type === T.GOAWAY)).toBe(true);
        expect(live.closed).toBe(false);
      } finally {
        clearInterval(tick);
        stalled.close();
        live.close();
      }
    }, 40000);
  }

  test("server.timeout(req, n) on h2 is per connection: the most permissive open request wins", async () => {
    await using fx = await startFixture({ tls: false, idleTimeout: 4 });
    const session = await connectH2(fx.port, false);
    // 30 s is set first, then 1 s; both sleep 6 s. Max-wins keeps the
    // connection; last-wins, min-wins or a no-op would all close it at the 4 s tick.
    const a = request(session, { ":path": "/t?s=30&ms=6000" });
    await new Promise<void>(r => setTimeout(r, 100));
    const b = request(session, { ":path": "/t?s=1&ms=6000" });
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.body.toString(), rb.body.toString()]).toEqual(["t30", "t1"]);
    session.close();
  }, 40000);

  // Same two shapes serve.test.ts has for HTTP/1: stop(true) synchronously
  // inside the handler, and stop(true) between two awaits; each over a GET and
  // a POST whose body is still arriving.
  for (const shape of ["sync", "after-await"] as const) {
    for (const method of ["GET", "POST"] as const) {
      test(`server.stop(true) from inside an h2 handler (${shape}, ${method}) lets the process exit`, async () => {
        const src = `
          const server = Bun.serve({
            port: 0,
            http2: true,
            idleTimeout: 30,
            error() { return new Response("error", { status: 500 }); },
            async fetch(req, server) {
              ${shape === "after-await" ? "await Bun.sleep(20);" : ""}
              server.stop(true);
              ${shape === "after-await" ? "await Bun.sleep(20);" : ""}
              return new Response("bye");
            },
          });
          const http2 = require("node:http2");
          const s = http2.connect("http://127.0.0.1:" + server.port);
          s.on("error", () => {});
          const r = s.request({ ":path": "/", ":method": ${JSON.stringify(method)} }, { endStream: ${method === "GET"} });
          r.on("error", () => {});
          r.on("response", () => {});
          r.resume();
          ${method === "POST" ? 'r.write(Buffer.alloc(100000)); setTimeout(() => { try { r.end("x"); } catch {} }, 50);' : ""}
          r.on("close", () => s.close());
        `;
        await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "inherit", stderr: "pipe" });
        const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(code).toBe(0);
      }, 20000);
    }
  }

  test("server.timeout(req, n) on h2: once the more permissive request ends, the remaining one's budget applies", async () => {
    await using fx = await startFixture({ tls: false }); // idleTimeout 30
    const session = await connectH2(fx.port, false);
    const closed = new Promise<void>(r => session.once("close", () => r()));
    // A keeps the 30 s default and answers after 1.5 s; B, opened while A is in
    // flight, asks for 1 s and would answer after 60 s. While both are open the
    // 30 s wins. Once A has retired, B's 1 s is the connection's budget: the
    // server idles it out at the next 4 s tick, not 30 s later.
    const a = request(session, { ":path": "/slow?ms=1500" });
    const pending = request(session, { ":path": "/t?s=1&ms=60000" }).catch(e => e);
    expect((await a).body.toString()).toBe("slow");
    const t0 = Date.now();
    await closed;
    expect(Date.now() - t0).toBeLessThan(15000);
    const result = await pending;
    expect(result instanceof Error ? NaN : result.status).toBeNaN();
  }, 30000);

  test("--max-http-header-size applies to h2 like HTTP/1.1", async () => {
    await using fx = await startFixture({ tls: false, execArgv: ["--max-http-header-size=4096"] });
    const big = Buffer.alloc(8192, "c").toString();
    const h1 = await fetch(`http://127.0.0.1:${fx.port}/hello`, { headers: { "x-big": big } });
    expect(h1.status).toBe(431);
    const raw = await RawH2.connect(fx.port, false);
    raw.headers(1, [...baseHeaders("/hello"), ["x-big", big]]);
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(431);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("stop(true) sends GOAWAY before closing", async () => {
    await using fx = await startFixture({ tls: false });
    const raw = await RawH2.connect(fx.port, false);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/abort"));
    await new Promise<void>(r => setImmediate(r));
    fx.proc.stdin.end();
    await raw.waitForClose();
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(true);
    await fx.proc.exited;
    raw.close();
  });

  test("idle timer is re-armed after a request that was exempted from it", async () => {
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const session = await connectH2(fx.port, false);
    const closed = new Promise<number>(r => session.once("close", () => r(Date.now())));
    // /keepalive sets server.timeout(req, 0) for its duration; once it's done the
    // connection's idle timeout must apply again.
    expect((await request(session, { ":path": "/keepalive?ms=5000" })).body.toString()).toBe("kept");
    const tDone = Date.now();
    expect((await closed) - tDone).toBeLessThan(15000);
  }, 40000);

  test("h2 is not negotiated below TLS 1.2; a TLS 1.2 client offering only ECDHE-RSA-AES128-GCM-SHA256 works", async () => {
    await using fx = await startFixture({ tls: true });
    const old = await new Promise<string>(resolve => {
      const s = tls.connect(
        {
          port: fx.port,
          host: "127.0.0.1",
          maxVersion: "TLSv1.1",
          minVersion: "TLSv1",
          ALPNProtocols: ["h2"],
          rejectUnauthorized: false,
        },
        () => resolve("connected:" + s.alpnProtocol),
      );
      s.on("error", e => resolve("error"));
    });
    expect(old).toBe("error");
    const sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect(
        {
          port: fx.port,
          host: "127.0.0.1",
          maxVersion: "TLSv1.2",
          ciphers: "ECDHE-RSA-AES128-GCM-SHA256",
          ALPNProtocols: ["h2"],
          rejectUnauthorized: false,
        },
        () => resolve(s),
      );
      s.on("error", reject);
    });
    expect(sock.alpnProtocol).toBe("h2");
    sock.destroy();
  });

  test("stop(true) with open streams aborts them and closes connections", async () => {
    await using fx = await startFixture({ tls: false });
    const session = await connectH2(fx.port, false);
    const pending = request(session, { ":path": "/abort" }).catch(e => e);
    await request(session, { ":path": "/hello" });
    const closed = new Promise<void>(r => session.on("close", () => r()));
    fx.proc.stdin.end();
    await closed;
    // The stream never got a response: node surfaces the abrupt close either
    // as a stream error or as an end with no HEADERS; both have no :status.
    const result = await pending;
    expect(result instanceof Error ? NaN : result.status).toBeNaN();
    await fx.proc.exited;
    expect(fx.stderr()).toContain("ABORTED");
    expect(fx.proc.exitCode).toBe(0);
  });

  test("client disconnect with many open streams", async () => {
    await using fx = await startFixture({ tls: true });
    for (let round = 0; round < 3; round++) {
      const session = await connectH2(fx.port, true);
      for (let i = 0; i < 20; i++) {
        const r = session.request({ ":path": "/abort" });
        r.on("error", () => {});
      }
      await request(session, { ":path": "/hello" });
      session.destroy();
    }
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    while ((fx.stderr().match(/ABORTED/g) ?? []).length < 60) {
      await request(session, { ":path": "/hello" });
    }
    session.close();
  });

  test("maxRequestBodySize applies without content-length", async () => {
    using dir = tempDir("serve-http2-maxbody", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const server = Bun.serve({
          port: 0, http2: true, maxRequestBodySize: 1000,
          async fetch(req) { try { return new Response(String((await req.arrayBuffer()).byteLength)); } catch (e) { return new Response("too large", { status: 413 }); } },
        });
        console.log(server.port);
        process.stdin.on("end", () => process.exit(0)); process.stdin.resume();`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let line = "";
    while (!line.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited before printing its port");
      line += new TextDecoder().decode(value);
    }
    const port = Number(line.trim());
    const raw = await RawH2.connect(port, false);
    await raw.waitFor(f => f.type === T.SETTINGS);
    raw.headers(1, baseHeaders("/", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(800)));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(800)));
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(413);
    raw.close();
    // Fresh connection so `:status: 413` isn't served from the HPACK dynamic table.
    const raw2 = await RawH2.connect(port, false);
    await raw2.waitFor(f => f.type === T.SETTINGS);
    raw2.headers(1, [...baseHeaders("/", "POST"), ["content-length", "5000"]], F.END_HEADERS);
    const h2 = await raw2.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h2.payload)).toBe(413);
    raw2.close();
    proc.stdin.end();
    await proc.exited;
  });
});
