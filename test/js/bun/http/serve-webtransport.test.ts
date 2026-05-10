import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { bunEnv, bunExe, isLinux } from "harness";
import path from "path";

// WebTransport over HTTP/3 (draft-ietf-webtrans-http3). Bun.serve advertises
// WT support whenever `h3: true` is set; routes are taken from the same
// `websocket:` handler block as RFC 6455 sockets, so a ServerWebSocket
// arriving over a WT session sees the identical open/message/close API.
//
// There is no in-tree WT-capable curl, so the end-to-end tests compile a
// tiny lsquic-based client (fixtures/wtclient.c) against the dep objects the
// debug build already produced. Compilation is Linux-only because the client
// uses poll()+recvfrom directly; the protocol layer it exercises is
// platform-independent.

const fixtureDir = path.join(import.meta.dir, "fixtures");
const wtclientBin = path.join(fixtureDir, "wtclient");

let canRunClient = false;

beforeAll(async () => {
  if (!isLinux) return;
  // Debug-profile dep objects live under build/debug/obj/vendor; bundle the
  // ones lsquic needs into one .a so the cc command line stays short.
  const objRoot = path.resolve(import.meta.dir, "../../../../build/debug/obj/vendor");
  const vendor = path.resolve(import.meta.dir, "../../../../vendor");
  const deps = ["lsquic", "lsqpack", "lshpack", "boringssl", "zlib"];
  const libdeps = path.join(fixtureDir, "libwtdeps.a");

  if (!existsSync(path.join(objRoot, "lsquic")) || !existsSync(path.join(vendor, "lsquic/include/lsquic.h"))) {
    console.warn("serve-webtransport: skipping (no debug-profile dep objects under build/debug/obj/vendor)");
    return;
  }

  // The dep .o files are built with -gz=zstd; the system ld.lld may have
  // been built without zstd support, so use the same llvm toolchain the
  // build used. Matches the search paths in scripts/build/tools.ts.
  const llvmDirs = ["/opt/llvm-21/bin", "/usr/lib/llvm-21/bin", "/usr/lib/llvm21/bin"];
  const llvm = (t: string) => {
    for (const d of llvmDirs) if (existsSync(`${d}/${t}`)) return `${d}/${t}`;
    return t;
  };
  const lld = llvm("ld.lld");

  if (!existsSync(libdeps)) {
    const objs: string[] = [];
    for (const d of deps) {
      for await (const f of new Bun.Glob("**/*.o").scan({ cwd: path.join(objRoot, d), absolute: true })) {
        objs.push(f);
      }
    }
    const ar = Bun.spawnSync({ cmd: [llvm("llvm-ar"), "rcs", libdeps, ...objs] });
    if (ar.exitCode !== 0) {
      // The dep objects exist, so failing to archive them is a real error
      // rather than an environment-shaped skip.
      throw new Error("serve-webtransport: llvm-ar failed\n" + ar.stderr.toString());
    }
  }

  const cc = Bun.spawnSync({
    cmd: [
      process.env.CC ?? llvm("clang"),
      // -fuse-ld=lld resolves via PATH, which may pick up an lld that
      // can't read zstd-compressed debug sections; pin to the same one
      // the build used when we found it.
      lld !== "ld.lld" ? `--ld-path=${lld}` : "-fuse-ld=lld",
      "-std=c11",
      "-O1",
      "-g",
      "-fsanitize=address",
      "-fno-pie",
      "-no-pie",
      "-DLSQUIC_WEBTRANSPORT_SERVER_SUPPORT=1",
      `-I${vendor}/lsquic/include`,
      `-I${vendor}/lshpack`,
      `-I${vendor}/boringssl/include`,
      "-o",
      wtclientBin,
      path.join(fixtureDir, "wtclient.c"),
      libdeps,
      "-lstdc++",
      "-lm",
      "-lpthread",
    ],
    stderr: "pipe",
  });
  if (cc.exitCode !== 0) {
    // Same as above: once the prerequisites exist, a compile failure is a
    // hard error so the suite cannot silently pass with a broken fixture.
    throw new Error("serve-webtransport: wtclient.c compile failed\n" + cc.stderr.toString());
  }
  canRunClient = true;
});

afterAll(() => {
  // Leave the .a for subsequent test runs (it's content-stable); drop the
  // executable so a stale debug build doesn't mask a regression.
  try {
    unlinkSync(wtclientBin);
  } catch {}
});

const itWT: typeof test = ((name: string, fn: any) =>
  test(name, async () => {
    if (!canRunClient) {
      console.warn("skipping (no wtclient; needs Linux + debug build deps)");
      return;
    }
    return fn();
  })) as any;

const b64u = (s: string | Uint8Array) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Thin async iterator over the wtclient stdio protocol. */
function spawnClient(port: number, urlPath = "/") {
  const proc = Bun.spawn({
    cmd: [wtclientBin, String(port), urlPath],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const writer = proc.stdin;
  const events: string[][] = [];
  const waiters: ((e: string[]) => void)[] = [];
  let leftover = "";
  (async () => {
    for await (const chunk of proc.stdout) {
      leftover += Buffer.from(chunk).toString();
      let nl: number;
      while ((nl = leftover.indexOf("\n")) >= 0) {
        const line = leftover.slice(0, nl);
        leftover = leftover.slice(nl + 1);
        const parts = line.split(" ");
        const w = waiters.shift();
        if (w) w(parts);
        else events.push(parts);
      }
    }
  })();
  const next = (): Promise<string[]> =>
    events.length ? Promise.resolve(events.shift()!) : new Promise(r => waiters.push(r));
  const expectEvent = async (kind: string) => {
    const e = await Promise.race([
      next(),
      Bun.sleep(8000).then(() => {
        throw new Error(`timed out waiting for "${kind}"`);
      }),
    ]);
    expect(e[0]).toBe(kind);
    return e;
  };
  return {
    proc,
    next,
    expectEvent,
    sendDatagram: (d: string | Uint8Array) => writer.write(`dgram ${b64u(d)}\n`),
    sendStream: (d: string | Uint8Array) => writer.write(`stream ${b64u(d)}\n`),
    close: (code = 0, msg: string | Uint8Array = "") => writer.write(`close ${code} ${b64u(msg)}\n`),
    kill: () => {
      writer.end();
      proc.kill();
    },
  };
}

/** Spawn a Bun.serve subprocess so a server-side crash surfaces as a test
 * failure instead of taking the test runner down. */
async function spawnServer(handlers: string) {
  const src = `
    const { tls } = require("harness");
    const server = Bun.serve({
      tls, port: 0, h3: true,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: { ${handlers} },
    });
    console.log(JSON.stringify({ port: server.port }));
    process.stdin.on("end", () => server.stop(true));
    process.stdin.resume();
  `;
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    cwd: import.meta.dir,
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  const lines: string[] = [];
  let buf = "";
  let port = 0;
  const readLine = async (): Promise<string> => {
    while (true) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        lines.push(l);
        return l;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited:\n" + lines.join("\n") + "\n" + buf);
      buf += Buffer.from(value).toString();
    }
  };
  const first = await readLine();
  port = JSON.parse(first).port;
  return {
    port,
    readLine,
    proc,
    [Symbol.dispose]() {
      proc.stdin.end();
      proc.kill();
    },
  };
}

// ───── lifecycle ─────

test("h3+websocket server starts and stops cleanly", async () => {
  // No client needed: this guards against the WT context-data placement-new
  // and TopicTree teardown leaking or crashing on a hot reload path.
  await using server = await spawnServer(`open(ws) {}, message(ws, m) {}, close(ws) {}`);
  expect(server.port).toBeGreaterThan(0);
});

// ───── end-to-end ─────

describe("WebTransport over HTTP/3", () => {
  itWT("session establishes and open() fires", async () => {
    await using server = await spawnServer(`
      open(ws) { console.log("open " + (ws.remoteAddress ? "addr" : "noaddr")); },
      message(ws, m) {},
      close(ws, code, reason) { console.log("close " + code + " " + reason); },
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toMatch(/^open addr$/);
    } finally {
      c.kill();
    }
  });

  itWT("client → server datagram fires message()", async () => {
    await using server = await spawnServer(`
      open(ws) {},
      message(ws, m) {
        console.log("msg " + (typeof m === "string" ? m : Buffer.from(m).toString()));
      },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      c.sendDatagram("hello-dgram");
      expect(await server.readLine()).toBe("msg hello-dgram");
      c.sendDatagram("second");
      expect(await server.readLine()).toBe("msg second");
    } finally {
      c.kill();
    }
  });

  itWT("server → client datagram via ws.send()", async () => {
    await using server = await spawnServer(`
      open(ws) { ws.send("from-server"); ws.send(new Uint8Array([1,2,3,4])); },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      const d1 = await c.expectEvent("dgram");
      const d2 = await c.expectEvent("dgram");
      const got = [fromB64u(d1[1]).toString(), fromB64u(d2[1]).toString("hex")].sort();
      // Datagrams are unordered; assert on the set.
      expect(got).toEqual(["01020304", "from-server"].sort());
    } finally {
      c.kill();
    }
  });

  itWT("echo: send() inside message()", async () => {
    await using server = await spawnServer(`
      open() {},
      message(ws, m) { ws.send(m); },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      for (const msg of ["a", "bb", "ccc", Buffer.alloc(500, "x").toString()]) {
        c.sendDatagram(msg);
        const e = await c.expectEvent("dgram");
        expect(fromB64u(e[1]).toString()).toBe(msg);
      }
    } finally {
      c.kill();
    }
  });

  // The 0x41-prefixed bidi stream path is implemented server-side (lsquic's
  // hq filter recognises the signal value, quic.c routes via on_wt_stream_data,
  // and Http3Context reassembles to a single message() call). wtclient can't
  // exercise it because lsquic in HTTP client mode wraps every write in a
  // DATA frame — there's no public API to emit raw stream bytes. A real
  // browser (Chromium WebTransport) does write the raw prefix; this is left
  // for a Playwright fixture or once lsquic grows a bypass.
  test.todo("client bidi stream (0x41) delivers as one message");

  itWT("ws.close(code, reason) sends WT_CLOSE_SESSION", async () => {
    await using server = await spawnServer(`
      open(ws) {},
      message(ws, m) { ws.close(4001, "bye-" + Buffer.from(m).toString()); },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      c.sendDatagram("now");
      const e = await c.expectEvent("close");
      expect(e[1]).toBe("4001");
      expect(fromB64u(e[2]).toString()).toBe("bye-now");
    } finally {
      c.kill();
    }
  });

  itWT("client WT_CLOSE_SESSION fires close(code, reason)", async () => {
    await using server = await spawnServer(`
      open() {},
      message() {},
      close(ws, code, reason) { console.log("closed " + code + " " + reason); },
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      c.close(4321, "client-says-goodbye");
      expect(await server.readLine()).toBe("closed 4321 client-says-goodbye");
    } finally {
      c.kill();
    }
  });

  itWT("subscribe / publish across two sessions", async () => {
    await using server = await spawnServer(`
      open(ws) { ws.subscribe("room"); console.log("joined"); },
      message(ws, m) { ws.publish("room", m); },
      close() {},
    `);
    const a = spawnClient(server.port);
    const b = spawnClient(server.port);
    try {
      await a.expectEvent("open");
      await b.expectEvent("open");
      expect(await server.readLine()).toBe("joined");
      expect(await server.readLine()).toBe("joined");
      a.sendDatagram("hi-from-a");
      const e = await b.expectEvent("dgram");
      expect(fromB64u(e[1]).toString()).toBe("hi-from-a");
    } finally {
      a.kill();
      b.kill();
    }
  });

  itWT("ws.publish() crosses the WT/WS TopicTree boundary", async () => {
    // A mixed room (one RFC 6455 client + one WebTransport client) must
    // not be partitioned by transport: ws.publish() from either side has
    // to reach subscribers on the other tree.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { tls } = require("harness");
        const server = Bun.serve({
          tls, port: 0, h3: true,
          fetch(req, s) { if (s.upgrade(req)) return; return new Response("ok"); },
          websocket: {
            open(ws) { ws.subscribe("room"); console.log("joined"); },
            message(ws, m) { ws.publish("room", "relay:" + m); },
            close() {},
          },
        });
        console.log(JSON.stringify({ port: server.port }));
        // In-process RFC 6455 client on the SSL app's tree.
        const wc = new WebSocket("wss://localhost:" + server.port + "/", {
          tls: { rejectUnauthorized: false },
        });
        wc.onmessage = e => console.log("ws-recv " + e.data);
        wc.onopen = () => console.log("ws-open");
        process.stdin.on("data", d => {
          const s = d.toString().trim();
          if (s === "ws-send") wc.send("from-ws");
        });
        process.stdin.on("end", () => { wc.close(); server.stop(true); });
        process.stdin.resume();
      `,
      ],
      cwd: import.meta.dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let buf = "";
    const readLine = async () => {
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const l = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          return l;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("server exited:\n" + buf);
        buf += Buffer.from(value).toString();
      }
    };
    const { port } = JSON.parse(await readLine());
    // The in-process WS client connects first; wait for both the
    // server-side open() ("joined") and the client-side onopen
    // ("ws-open") — order between them isn't guaranteed.
    expect([await readLine(), await readLine()].sort()).toEqual(["joined", "ws-open"]);
    const c = spawnClient(port);
    try {
      await c.expectEvent("open");
      // WT client's open() → second "joined".
      expect(await readLine()).toBe("joined");
      // WT → WS: publish from the WT session must reach the WS client.
      c.sendDatagram("from-wt");
      expect(await readLine()).toBe("ws-recv relay:from-wt");
      // WS → WT: publish from the WS session must reach the WT client.
      proc.stdin.write("ws-send\n");
      const d = await c.expectEvent("dgram");
      expect(fromB64u(d[1]).toString()).toBe("relay:from-ws");
    } finally {
      c.kill();
      proc.stdin.end();
    }
  });

  itWT("server.publish() and subscriberCount() reach the H3 TopicTree", async () => {
    // WT sessions subscribe onto the H3App's tree, not the TCP/SSL app's;
    // the server-level APIs must fan out to / sum from both.
    await using server = await spawnServer(`
      open(ws) {
        ws.subscribe("room");
        console.log("subs " + server.subscriberCount("room"));
      },
      message(ws, m) {
        const r = server.publish("room", "broadcast:" + m);
        console.log("publish " + (r > 0 ? "ok" : "zero"));
      },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("subs 1");
      c.sendDatagram("ping");
      expect(await server.readLine()).toBe("publish ok");
      const e = await c.expectEvent("dgram");
      expect(fromB64u(e[1]).toString()).toBe("broadcast:ping");
    } finally {
      c.kill();
    }
  });

  itWT("drain() fires only after backpressure, not on open", async () => {
    // open() does one send (SUCCESS) so hadBackpressure stays false across
    // the post-upgrade wantwrite flush; message() then queues two sends so
    // the second reports BACKPRESSURE and drain fires once the queue empties.
    await using server = await spawnServer(`
      open(ws) { ws.send("hello"); console.log("opened"); },
      message(ws) {
        ws.send(Buffer.alloc(800, "a").toString());
        ws.send(Buffer.alloc(800, "b").toString());
        console.log("queued " + (ws.getBufferedAmount() > 0));
      },
      drain(ws) { console.log("drain " + ws.getBufferedAmount()); },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("opened");
      // Consume the open()-time send, then trigger the backpressure path.
      const first = await c.expectEvent("dgram");
      expect(fromB64u(first[1]).toString()).toBe("hello");
      c.sendDatagram("go");
      // If drain fired on the post-upgrade flush it would appear before
      // "queued", so the first line after "opened" must be "queued true".
      expect(await server.readLine()).toBe("queued true");
      expect(await server.readLine()).toBe("drain 0");
    } finally {
      c.kill();
    }
  });

  itWT("ws.send() returns DROPPED for over-MTU payload", async () => {
    await using server = await spawnServer(`
      open(ws) {
        const r1 = ws.send(Buffer.alloc(64, "x").toString());
        const r2 = ws.send(Buffer.alloc(2000, "x").toString());
        // ServerWebSocket.send returns bytes-written on success, -1 on
        // backpressure, 0 on drop. Datagrams queue (so r1 is 64 or -1); the
        // 2000-byte one exceeds the 1200-byte QUIC DATAGRAM cap and is
        // dropped synchronously.
        console.log("send " + (r1 !== 0 ? "ok" : "drop") + " " + (r2 === 0 ? "drop" : "ok"));
      },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("send ok drop");
    } finally {
      c.kill();
    }
  });

  itWT("ws.ping()/ws.pong() are no-ops (DROPPED), not application datagrams", async () => {
    // WebTransport has no control frames; QUIC owns keepalive. A shared
    // websocket:{} block that calls ws.ping() for RFC 6455 liveness must
    // not leak a payload into the WT peer's message() handler.
    await using server = await spawnServer(`
      open(ws) {
        const p1 = ws.ping("probe");
        const p2 = ws.pong();
        console.log("ping " + p1 + " pong " + p2);
        ws.send("real");
      },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("ping 0 pong 0");
      // Only the explicit send() reaches the peer; if ping/pong had been
      // forwarded as datagrams they'd arrive first.
      const d = await c.expectEvent("dgram");
      expect(fromB64u(d[1]).toString()).toBe("real");
    } finally {
      c.kill();
    }
  });

  // wtclient always sends :protocol=webtransport, so the negative branch in
  // H3App::wt() (yield to the next route on a non-WT CONNECT) isn't reachable
  // from this fixture. Covered once wtclient grows a configurable :protocol.
  test.todo("non-WT CONNECT does not hit websocket handler");

  itWT("rejected upgrade returns the fetch response", async () => {
    // The CONNECT routes through fetch; if fetch declines to call
    // server.upgrade() the websocket handlers must not fire and the client
    // must see the non-2xx status.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { tls } = require("harness");
        const server = Bun.serve({
          tls, port: 0, h3: true,
          fetch(req, server) {
            if (!new URL(req.url).pathname.startsWith("/deny"))
              if (server.upgrade(req, { data: { tag: "ok" } })) return;
            return new Response("denied", { status: 403 });
          },
          websocket: {
            open(ws) { console.log("opened " + ws.data.tag); },
            message() {}, close() {},
          },
        });
        console.log(JSON.stringify({ port: server.port }));
        process.stdin.on("end", () => server.stop(true));
        process.stdin.resume();
        `,
      ],
      cwd: import.meta.dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let buf = "";
    const readLine = async () => {
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const l = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          return l;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("server exited");
        buf += Buffer.from(value).toString();
      }
    };
    const port = JSON.parse(await readLine()).port;

    // Allowed path: open() fires with the per-request data attached.
    const a = spawnClient(port, "/allow");
    await a.expectEvent("open");
    expect(await readLine()).toBe("opened ok");
    a.kill();

    // Denied path: client sees 403, server never logs "opened".
    const d = spawnClient(port, "/deny");
    const e = await d.expectEvent("error");
    expect(e[1]).toBe("status-403");
    d.kill();

    proc.stdin.end();
  });

  itWT("many sequential datagrams survive reordering", async () => {
    await using server = await spawnServer(`
      open() {},
      message(ws, m) { ws.send(m); },
      close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      const N = 50;
      for (let i = 0; i < N; i++) c.sendDatagram(String(i));
      const seen = new Set<string>();
      // Datagrams may drop; require ≥80% delivery on loopback.
      while (seen.size < N) {
        const e = await Promise.race([c.next(), Bun.sleep(500).then(() => null)]);
        if (!e) break;
        if (e[0] === "dgram") seen.add(fromB64u(e[1]).toString());
      }
      expect(seen.size).toBeGreaterThanOrEqual(Math.floor(N * 0.8));
    } finally {
      c.kill();
    }
  });

  itWT("first ws.send() returns SUCCESS (byte count), not backpressure", async () => {
    await using server = await spawnServer(`
      open(ws) {
        const r = ws.send("first");
        console.log("send " + r);
      },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      // ServerWebSocket.send → length on SUCCESS, -1 on BACKPRESSURE.
      // Prior to the fix the C++ layer always reported BACKPRESSURE because
      // the queue depth was sampled *after* enqueue.
      expect(await server.readLine()).toBe("send 5");
    } finally {
      c.kill();
    }
  });

  itWT("ws.subscriptions reflects subscribe()/unsubscribe()", async () => {
    await using server = await spawnServer(`
      open(ws) {
        ws.subscribe("a"); ws.subscribe("b");
        const t = ws.subscriptions; t.sort();
        console.log("topics " + JSON.stringify(t));
      },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe('topics ["a","b"]');
    } finally {
      c.kill();
    }
  });

  itWT("oversized capsule on CONNECT stream resets the session", async () => {
    // RFC 9297 §3.3: reject capsule lengths beyond what we'll buffer. The
    // client streams a capsule header advertising 2^30 bytes followed by
    // junk; the server must close (1009) instead of buffering forever.
    await using server = await spawnServer(`
      maxPayloadLength: 4096,
      open() { console.log("opened"); },
      message() {},
      close(ws, code) { console.log("closed " + code); },
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("opened");
      // Unknown-type capsule with a 4-byte length varint = ~1 GiB, then keep
      // streaming body; the cap fires once buffered bytes exceed 4 KiB.
      c.proc.stdin.write(`capsule ${b64u(Buffer.from([0x78, 0xae, 0xbf, 0xff, 0xff, 0xff]))}\n`);
      const kib = b64u(Buffer.alloc(1024, "X"));
      for (let i = 0; i < 8; i++) c.proc.stdin.write(`capsule ${kib}\n`);
      const line = await server.readLine();
      expect(line).toMatch(/^closed (1009|1006)$/);
    } finally {
      c.kill();
    }
  });

  itWT("getBufferedAmount reflects queued datagrams", async () => {
    await using server = await spawnServer(`
      open(ws) {
        ws.send(Buffer.alloc(800, "a").toString());
        ws.send(Buffer.alloc(800, "b").toString());
        console.log("buffered " + (ws.getBufferedAmount() > 0));
      },
      message() {}, close() {},
    `);
    const c = spawnClient(server.port);
    try {
      await c.expectEvent("open");
      expect(await server.readLine()).toBe("buffered true");
    } finally {
      c.kill();
    }
  });
});

// Guard regressions in the in-process path: starting an h3+websocket server
// and tearing it down should leave no dangling refs that keep the loop alive.
test("server with h3+websocket exits when stopped", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { tls } = require("harness");
      const server = Bun.serve({
        tls, port: 0, h3: true,
        fetch: () => new Response("ok"),
        websocket: { open() {}, message() {}, close() {} },
      });
      server.stop(true);
      `,
    ],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(code).toBe(0);
});
