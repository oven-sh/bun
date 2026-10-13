import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import http2 from "node:http2";
import { join } from "node:path";
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

  test("http1: false with both h2 and h3", async () => {
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
      r.on("data", (c: Buffer) => chunks.push(c));
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

// A server that answers a connection it is done with by close(2) resets it when the client still
// sends, and the reset drops what the kernel has not delivered yet: the end of a response, the
// GOAWAY. These tests put the server in exactly that state without a timing assumption. Either a
// frame is unread in the server's kernel when the server acts (the /hold handler keeps the fixture's
// event loop stopped until the test creates a file), or the client does not read and sends its
// frame after the server's FIN. Each client must then see every byte, the GOAWAY, and a FIN.
const holdPath = (dir: string, action: string, ms = 0) =>
  `/hold?do=${action}&ms=${ms}&file=${encodeURIComponent(join(dir, "release"))}`;
const release = (dir: string) => writeFileSync(join(dir, "release"), "");
const ping = () => frame(T.PING, 0, 0, Buffer.from("8 bytes!"));

/** A raw client whose windows take a whole response, so flow control never holds one back. */
async function connectWide(port: number, secure: boolean, opts: { allowHalfOpen?: boolean } = {}) {
  const raw = await RawH2.connect(port, secure, { settings: Buffer.from([0, 4, 0x40, 0, 0, 0]), ...opts });
  raw.write(frame(T.WINDOW_UPDATE, 0, 0, Buffer.from([0x40, 0, 0, 0])));
  await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
  return raw;
}

/** The connection ended in order: GOAWAY(`code`) for `lastStreamId`, then the server's FIN. */
async function expectGoawayThenFin(raw: RawH2, lastStreamId: number, code = 0) {
  expect(await raw.goaway()).toEqual({ lastStreamId, code });
  await raw.waitForEnd();
  expect(raw.error).toBeUndefined();
}

describe.each([
  ["h2c", false],
  ["TLS", true],
] as const)("Bun.serve http2 graceful close over %s", (_, secure) => {
  const bodySize = 1024 * 1024;
  const connectRaw = (port: number, opts: { allowHalfOpen?: boolean } = {}) => connectWide(port, secure, opts);

  test("stop() with a response in flight: a frame the client sent meanwhile does not cut it", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const raw = await connectRaw(fx.port);
    raw.headers(1, baseHeaders("/gate?n=" + bodySize));
    await fx.stderrHas("GATED");
    // Same connection: the response completes inside this connection's own socket event.
    raw.headers(3, baseHeaders(holdPath(String(dir), "stop")));
    await fx.stderrHas("HOLDING");
    await raw.writeFlushed(ping());
    release(String(dir));
    expect((await raw.body(1)).length).toBe(bodySize);
    expect((await raw.body(3)).toString()).toBe("held");
    await expectGoawayThenFin(raw, 3);
    await fx.stderrHas("STOPPED");
  });

  test("stop() from another connection: the response ends outside a socket event and is not cut", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const raw = await connectRaw(fx.port);
    raw.headers(1, baseHeaders("/gate?n=" + bodySize));
    await fx.stderrHas("GATED");
    const control = await connectRaw(fx.port);
    control.headers(1, baseHeaders(holdPath(String(dir), "stop")));
    await fx.stderrHas("HOLDING");
    await raw.writeFlushed(ping());
    release(String(dir));
    expect((await raw.body(1)).length).toBe(bodySize);
    await expectGoawayThenFin(raw, 1);
    expect((await control.body(1)).toString()).toBe("held");
    await expectGoawayThenFin(control, 1);
    await fx.stderrHas("STOPPED");
  });

  test("stop() with a response in flight: frames the client sends after the server's FIN do not cut it", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const raw = await connectRaw(fx.port);
    raw.headers(1, baseHeaders("/gate?n=" + bodySize));
    await fx.stderrHas("GATED");
    const control = await connectRaw(fx.port);
    control.headers(1, baseHeaders(holdPath(String(dir), "stop")));
    await fx.stderrHas("HOLDING");
    // This side reads nothing from here on: its kernel takes one receive window of the response
    // and the server's kernel keeps the rest, also after the server is done with the connection.
    raw.socket.pause();
    release(String(dir));
    // The server ends `raw` first and `control` after it: control's FIN says `raw` has its FIN.
    expect((await control.body(1)).toString()).toBe("held");
    await expectGoawayThenFin(control, 1);
    // Nothing was unread when the server ended `raw`. These frames arrive afterwards. A reset
    // that answers the first one fails the second write.
    await raw.writeFlushed(ping());
    await raw.writeFlushed(ping());
    raw.socket.resume();
    expect((await raw.body(1)).length).toBe(bodySize);
    await expectGoawayThenFin(raw, 1);
    await fx.stderrHas("STOPPED");
  });

  test("stop() with a response larger than the kernel buffers: a frame for every chunk read does not cut it", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const size = 16 * 1024 * 1024;
    const raw = await connectRaw(fx.port);
    raw.headers(1, baseHeaders("/gate?n=" + size));
    await fx.stderrHas("GATED");
    raw.headers(3, baseHeaders(holdPath(String(dir), "stop")));
    await fx.stderrHas("HOLDING");
    // Like a client that sends WINDOW_UPDATE or PING while it downloads.
    raw.socket.on("data", () => {
      if (!raw.ended && !raw.closed) raw.write(ping());
    });
    release(String(dir));
    expect((await raw.body(1)).length).toBe(size);
    await expectGoawayThenFin(raw, 3);
    // 16 MiB is what a TLS connection needs to show the cut, and seconds in a debug build.
  }, 20000);

  test("stop() ends an idle connection with GOAWAY and a FIN when a frame crosses it", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const idle = await connectRaw(fx.port);
    const control = await connectRaw(fx.port);
    control.headers(1, baseHeaders(holdPath(String(dir), "stop")));
    await fx.stderrHas("HOLDING");
    await idle.writeFlushed(ping());
    release(String(dir));
    await expectGoawayThenFin(idle, 0);
    expect((await control.body(1)).toString()).toBe("held");
    await expectGoawayThenFin(control, 1);
    await fx.stderrHas("STOPPED");
  });

  test("closeIdleConnections() ends an idle connection with GOAWAY and a FIN, and counts it once", async () => {
    await using fx = await startFixture({ tls: secure });
    using dir = tempDir("serve-http2-hold", {});
    const idle = await connectRaw(fx.port);
    const control = await connectRaw(fx.port);
    control.headers(1, baseHeaders(holdPath(String(dir), "close-idle")));
    await fx.stderrHas("HOLDING");
    await idle.writeFlushed(ping());
    release(String(dir));
    await expectGoawayThenFin(idle, 0);
    // Two calls in a row: the first one finishes the idle connection, the second one leaves it alone.
    expect((await control.body(1)).toString()).toBe("held1,0");
    // The busy connection was spared and the server still serves it.
    control.headers(3, baseHeaders("/hello"));
    expect((await control.body(3)).toString()).toBe("hello");
    control.close();
  });

  test("a client GOAWAY is answered with GOAWAY and a FIN once its streams are done", async () => {
    await using fx = await startFixture({ tls: secure });
    const raw = await connectRaw(fx.port);
    raw.headers(1, baseHeaders("/slow?ms=50"));
    raw.write(frame(T.GOAWAY, 0, 0, Buffer.alloc(8)));
    expect((await raw.body(1)).toString()).toBe("slow");
    await expectGoawayThenFin(raw, 1);
  });

  test("a connection error ends the streams, reports its code and ends with a FIN; later frames are not reset", async () => {
    await using fx = await startFixture({ tls: secure });
    const raw = await connectRaw(fx.port, { allowHalfOpen: true });
    raw.headers(1, baseHeaders("/abort"));
    // The connection window already holds 2^30: one more of these overflows it. The frame comes
    // in two reads, so the server finds the error in a frame it had to put together. The answer
    // to the PING says that the server has read up to the first part.
    const overflow = frame(T.WINDOW_UPDATE, 0, 0, Buffer.from([0x7f, 0xff, 0xff, 0xff]));
    raw.write(Buffer.concat([frame(T.GOAWAY, 0, 0, Buffer.alloc(8)), ping(), overflow.subarray(0, 5)]));
    await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
    raw.write(overflow.subarray(5));
    await expectGoawayThenFin(raw, 1, 3);
    await fx.stderrHas("ABORTED");
    // This side is still open and keeps sending. A reset that answers the first frame fails the second write.
    await raw.writeFlushed(ping());
    await raw.writeFlushed(ping());
    raw.socket.end();
    await raw.waitForClose();
    expect(raw.error).toBeUndefined();
  });

  test("stop(true) closes a lingering connection before it returns", async () => {
    await using fx = await startFixture({ tls: secure });
    const raw = await connectRaw(fx.port, { allowHalfOpen: true });
    raw.headers(1, baseHeaders("/stop"));
    expect((await raw.body(1)).toString()).toBe("stopping");
    await expectGoawayThenFin(raw, 1);
    // This side never answers the FIN. The fixture reports whether stop(true) waited for it.
    fx.proc.stdin.end();
    await fx.stderrHas("STOPPED-AT-ONCE");
    raw.close();
  });

  test("stop(true) closes a connection with a stream open before it returns, whatever the client does", async () => {
    await using fx = await startFixture({ tls: secure });
    const raw = await connectRaw(fx.port, { allowHalfOpen: true });
    raw.headers(1, baseHeaders("/abort"));
    await raw.writeFlushed(ping());
    await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
    fx.proc.stdin.end();
    await fx.stderrHas("STOPPED-AT-ONCE");
    expect(fx.stderr()).toContain("ABORTED");
    expect((await raw.goaway()).code).toBe(0);
    raw.close();
  });
});

describe("Bun.serve http2 graceful close, the wait for the client's FIN", () => {
  // usockets ticks timeouts in 4 s steps, so these tests need real seconds. The client never closes
  // its side, so only the server's own bound ends the connection. stop() is called from the abort
  // listener of a stream the client resets: the connection then ends inside that callback, and the
  // stream's own timeout must not replace the bound afterwards.
  for (const [name, secure, idleTimeout, atLeastMs] of [
    // Idle timeouts are off: the bound is 8 s, which is 4 to 8 s on the 4 s tick.
    ["h2c, idleTimeout 0", false, 0, 3000],
    // The idle timeout is longer than 8 s, so it is the bound: 12 to 16 s.
    ["TLS, idleTimeout 16", true, 16, 9000],
  ] as const) {
    test(`a client that never closes holds stop() until the bound and no longer (${name})`, async () => {
      await using fx = await startFixture({ tls: secure, idleTimeout });
      const raw = await connectWide(fx.port, secure, { allowHalfOpen: true });
      raw.headers(1, baseHeaders("/abort-stop"));
      // The reset comes in two reads with a frame behind it: the server ends the connection from
      // inside a frame that it had to put together, and must not go on to the next one. The
      // answer to the PING says that the server has read up to the first part.
      const reset = frame(T.RST_STREAM, 0, 1, Buffer.from([0, 0, 0, 8]));
      raw.write(Buffer.concat([ping(), reset.subarray(0, 5)]));
      await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
      raw.write(Buffer.concat([reset.subarray(5), ping()]));
      await expectGoawayThenFin(raw, 1);
      const finAt = performance.now();
      // The promise of stop() stays pending while the connection lingers, so that a process
      // that exits after `await server.stop()` cannot cut what the client still reads.
      await fx.stderrHas("STOPPED");
      expect(performance.now() - finAt).toBeGreaterThan(atLeastMs);
      raw.close();
    }, 40000);
  }

  test("a client that keeps sending after the server's FIN is closed when it has sent more than a window", async () => {
    await using fx = await startFixture({ tls: false });
    const raw = await connectWide(fx.port, false, { allowHalfOpen: true });
    raw.headers(1, baseHeaders("/stop"));
    expect((await raw.body(1)).toString()).toBe("stopping");
    await expectGoawayThenFin(raw, 1);
    // The server reads and drops what still comes, up to the 16 MiB its connection window allowed
    // and 1 MiB more. Past that it closes, long before the wait for this side's FIN ends.
    raw.write(Buffer.alloc(18 * 1024 * 1024));
    await raw.waitForClose();
    await fx.stderrHas("STOPPED");
  });

  test("an idle timeout ends the connection with GOAWAY and a FIN when a frame crosses it", async () => {
    // idleTimeout 2 is one tick. /hold keeps the event loop stopped for more than a tick, so the
    // timeout of the idle connection fires right after it, with this client's frame still unread.
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    using dir = tempDir("serve-http2-hold", {});
    const idle = await connectWide(fx.port, false);
    const control = await connectWide(fx.port, false);
    control.headers(1, baseHeaders(holdPath(String(dir), "none", 4200)));
    await fx.stderrHas("HOLDING");
    await idle.writeFlushed(ping());
    release(String(dir));
    await expectGoawayThenFin(idle, 0);
    expect((await control.body(1)).toString()).toBe("held");
    control.close();
  }, 20000);
});

// These need a build with usockets fault injection (ASAN builds): a send() that takes nothing, or
// a few bytes only, is the kernel of a peer that does not read.
describe.skipIf(!fault.available() || isWindows)(
  "Bun.serve http2 graceful close when the kernel does not take the bytes",
  () => {
    const rule = (r: object) => encodeURIComponent(JSON.stringify(r));

    test.each([
      // send() takes nothing, twice: the GOAWAY stays in the connection's buffer.
      ["h2c", false, { syscall: "send", action: "zero", repeat: 2 }],
      // send() takes 5 bytes once: the rest of the sealed GOAWAY record stays in the TLS spill.
      ["TLS", true, { syscall: "send", action: "short", bytes: 5, repeat: 1 }],
    ] as const)(
      "closeIdleConnections() over %s neither counts nor ends a connection whose GOAWAY is not out; both follow",
      async (_, secure, blocked) => {
        await using fx = await startFixture({ tls: secure });
        const idle = await connectWide(fx.port, secure);
        const control = await connectWide(fx.port, secure);
        control.headers(1, baseHeaders("/fault-close-idle?rule=" + rule(blocked)));
        await expectGoawayThenFin(idle, 0);
        expect((await control.body(1)).toString()).toBe("counts 0,0");
        control.close();
      },
    );

    test("stop() does not cut a response that is still in the connection's buffer", async () => {
      await using fx = await startFixture({ tls: false });
      const raw = await connectWide(fx.port, false);
      raw.headers(1, baseHeaders("/respond-blocked?n=100000"));
      expect((await raw.body(1)).length).toBe(100000);
      await expectGoawayThenFin(raw, 1);
      await fx.stderrHas("STOPPED");
    });

    test("a connection error whose GOAWAY the kernel does not take closes the connection and ends its streams", async () => {
      await using fx = await startFixture({ tls: false });
      const raw = await connectWide(fx.port, false);
      raw.headers(1, baseHeaders("/abort"));
      // after: 1 lets the answer to this request out. The next send() is the GOAWAY of the error.
      raw.headers(3, baseHeaders("/arm?rule=" + rule({ syscall: "send", action: "zero", after: 1, repeat: 1 })));
      expect((await raw.body(3)).toString()).toBe("armed");
      raw.write(frame(T.WINDOW_UPDATE, 0, 0, Buffer.from([0x7f, 0xff, 0xff, 0xff])));
      await raw.waitForClose();
      await fx.stderrHas("ABORTED");
    });
  },
);
