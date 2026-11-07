import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isLinux, isWindows } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// fetch() is the client; the server runs in the parent test process and the
// fetch (with the fault armed) runs in a subprocess so faults only affect the
// client side of the connection.

async function runClientFetch(
  url: string,
  rule: import("bun:internal-for-testing").SocketFaultRule | null,
  opts: { ca?: string; readBytes?: number; abort?: boolean } = {},
) {
  const fixture = /* js */ `
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");
    const rule = ${JSON.stringify(rule)};
    if (rule) fault.set(rule);
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        ${opts.ca ? `tls: { ca: process.env.CA },` : ""}
      });
      ${
        opts.abort
          ? `
        const reader = res.body.getReader();
        let n = 0;
        while (n < ${opts.readBytes ?? 1024}) {
          const { value, done } = await reader.read();
          if (done) break;
          n += value.length;
        }
        await reader.cancel();
        console.log(JSON.stringify({ ok: true, status: res.status, n }));
      `
          : `
        const buf = await res.arrayBuffer();
        console.log(JSON.stringify({ ok: true, status: res.status, length: buf.byteLength }));
      `
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: false, code: e?.code, name: e?.name, message: String(e?.message ?? e) }));
    } finally {
      fault.clear();
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", ...(opts.ca ? { CA: opts.ca } : {}) },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

// The client for the close-delimited tests. It uploads a stream, reads the first piece of the answer, and
// only then arms `rule` and writes a chunk of the upload: nothing else is in flight, so the rule meets the
// send() of that chunk, or the recv() of what the server answers to it.
//   spill:    https. A send() that returns 0 first leaves the record of the chunk spilled in the TLS layer,
//             so `rule` meets the send() that drains the spill.
//   askToEnd: a request for /end follows the chunk. See `serveInTwoPieces`.
//   buffer:   the upload is a Buffer of this many bytes, not a stream. `rule` is armed before fetch(): with
//             `after: 1` it passes the send() of the head and the start of the body, and meets the send() of
//             the rest of the body, which follows at once.
async function runUploadingFetch(
  url: string,
  rule: import("bun:internal-for-testing").SocketFaultRule,
  opts: { ca?: string; spill?: boolean; askToEnd?: boolean; buffer?: number } = {},
) {
  const fixture = /* js */ `
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");
    const url = ${JSON.stringify(url)};
    const rule = ${JSON.stringify(rule)};
    const spill = ${JSON.stringify(!!opts.spill)};
    const buffer = ${JSON.stringify(opts.buffer ?? 0)};
    const tls = ${opts.ca ? "{ ca: process.env.CA }" : "undefined"};
    const firstRead = Promise.withResolvers();
    let pulls = 0;
    const stream = new ReadableStream(
      {
        async pull(controller) {
          if (++pulls === 1) {
            await firstRead.promise;
            fault.set(spill ? { syscall: "send", action: "zero", repeat: -1 } : rule);
            controller.enqueue(new Uint8Array(spill ? 64 * 1024 : 1024));
          } else if (spill && pulls === 2) {
            // The sink asks for more: TLS took the chunk and holds its record. The next send() drains it.
            fault.set(rule);
          }
        },
      },
      { highWaterMark: 0 },
    );
    let result, status;
    try {
      if (buffer) fault.set(rule);
      const upload = buffer ? Buffer.alloc(buffer, "u") : stream;
      const res = await fetch(url, { method: "POST", body: upload, duplex: "half", tls });
      status = res.status;
      const reader = res.body.getReader();
      let length = (await reader.read()).value.length;
      firstRead.resolve();
      ${
        opts.askToEnd
          ? `// One turn of the event loop: the pump has handed the chunk to the HTTP thread by then, and that
      // thread writes what it was handed before it starts a request.
      await new Promise(resolve => setImmediate(resolve));
      // A failure of this request must not look like the failure of the body read.
      await fetch(url + "end", { tls })
        .then(res => res.arrayBuffer())
        .catch(e => Promise.reject(new Error("the request for /end failed: " + e)));`
          : ""
      }
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
      }
      result = { ok: true, status, length };
    } catch (e) {
      result = { ok: false, status, code: e?.code, name: e?.name, message: String(e?.message ?? e) };
    } finally {
      fault.clear();
    }
    console.log(JSON.stringify(result));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", ...(opts.ca ? { CA: opts.ca } : {}) },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

// A raw server for a close-delimited answer in two pieces. "first" goes out when the request head is in.
// "rest" and the FIN follow when bytes of the upload arrive, or when a request for /end does: a chunk whose
// send() failed never reaches the server.
async function serveInTwoPieces(secure = false) {
  const sockets = new Set<net.Socket>();
  let answer: net.Socket | undefined;
  let ended = false;
  const end = () => {
    if (!ended) answer?.end("rest");
    ended = true;
  };
  const onConnection = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let head = "";
    socket.on("data", data => {
      if (socket === answer) return end();
      head += data.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      if (head.startsWith("GET /end ")) {
        end();
        return void socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
      answer = socket;
      socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nfirst");
    });
  };
  const server = secure
    ? tls.createServer({ key: certs.key, cert: certs.cert }, onConnection)
    : net.createServer(onConnection);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `${secure ? "https" : "http"}://127.0.0.1:${(server.address() as net.AddressInfo).port}/`,
    // close() alone waits for the connections that are still open.
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// A raw server for a close-delimited answer in two parts. The first part stays 4096 bytes below the 256 KiB
// of unread body at which fetch() stops reading, and the second part crosses that mark with its last bytes.
// Each request for / starts a new answer.
//   /       the head and the first part
//   /first  answered when the kernel has taken the whole first part
//   /cut    the second part on the connection of / and its reset, one call after the other, then the answer
//           to /cut
async function serveAcrossTheMark() {
  const MARK = 256 * 1024;
  const OK = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  const sockets = new Set<net.Socket>();
  let firstPartWritten = Promise.withResolvers<void>();
  let answer: net.Socket | undefined;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let head = "";
    const onData = (data: Buffer) => {
      head += data.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (head.startsWith("GET /first ")) {
        firstPartWritten.promise.then(() => socket.end(OK));
      } else if (head.startsWith("GET /cut ")) {
        answer!.write(Buffer.alloc(4096 + 64, "y"));
        answer!.resetAndDestroy();
        socket.end(OK);
      } else {
        answer = socket;
        const written = (firstPartWritten = Promise.withResolvers<void>());
        // Or the kernel can hold the second part back until the client acknowledges the first one, and
        // the reset then drops it.
        socket.setNoDelay(true);
        const first = Buffer.concat([
          Buffer.from("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"),
          Buffer.alloc(MARK - 4096, "x"),
        ]);
        socket.write(first, () => written.resolve());
      }
    };
    socket.on("data", onData);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`,
    // close() alone waits for the connections that are still open.
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// The client for `serveAcrossTheMark`. In each round nothing reads the body until the server has reset the
// connection. The server resets one call after it wrote the second part. When it stalls between the two (a
// collection of garbage is enough), the client reaches the mark first, and that round shows nothing: hence
// three rounds.
async function runSlowReader(url: string) {
  const fixture = /* js */ `
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");
    const url = ${JSON.stringify(url)};
    // A request that is not the one under test. Its failure must not look like the failure of the body read.
    const ask = path =>
      fetch(url + path)
        .then(res => res.arrayBuffer())
        .catch(e => Promise.reject(new Error("the request for /" + path + " failed: " + e)));
    const rounds = [];
    let failed;
    try {
      for (let round = 0; round < 3; round++) {
        const res = await fetch(url);
        // The client has the first part when this request is over: the server answers it after that part.
        await ask("first");
        // One byte for each recv() from here on. The client needs 4096 of them to reach the mark, and the
        // reset follows the second part at once.
        fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
        await ask("cut");
        fault.clear();
        rounds.push(
          await res.arrayBuffer().then(
            body => ({ ok: true, status: res.status, length: body.byteLength }),
            e => ({ ok: false, status: res.status, code: e?.code, name: e?.name }),
          ),
        );
      }
    } catch (e) {
      failed = String(e?.message ?? e);
    } finally {
      fault.clear();
    }
    console.log(JSON.stringify({ rounds, failed }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

describe.skipIf(skip)("fetch() under injected syscall faults (http)", () => {
  test("recv → ECONNRESET on response rejects with a connection error", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(Buffer.alloc(8192, "a")),
    });
    const r = await runClientFetch(server.url.href, {
      syscall: "recv",
      action: "errno",
      errno: "ECONNRESET",
      repeat: -1,
    });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(["ECONNRESET", "ConnectionClosed"]).toContain(r.code);
  });

  test("recv → short reads (1 byte) deliver complete body", async () => {
    const body = Buffer.alloc(8192, "z");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(body),
    });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
  });

  test("recv → short reads (1 byte) deliver complete chunked (Transfer-Encoding) body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(Buffer.alloc(100, "a"));
              c.enqueue(Buffer.alloc(200, "b"));
              c.enqueue(Buffer.alloc(50, "c"));
              c.close();
            },
          }),
        ),
    });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: 350, signal: null, exitCode: 0 });
  });

  test("send → short writes (1 byte) on the request still gets a response", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("ok"),
    });
    const r = await runClientFetch(server.url.href, { syscall: "send", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: 2, signal: null, exitCode: 0 });
  });

  test("connect → ECONNREFUSED rejects with ECONNREFUSED", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const r = await runClientFetch(server.url.href, {
      syscall: "connect",
      action: "errno",
      errno: "ECONNREFUSED",
      repeat: -1,
    });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    // fetch wraps connect failure as a generic open-socket error.
    expect(["ECONNREFUSED", "FailedToOpenSocket", "ConnectionRefused"]).toContain(r.code);
  });

  test("recv → 0 (peer closed) before any byte rejects cleanly (no hang)", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Buffer.alloc(1024)) });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "zero", repeat: -1 });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  // `send` faults the request-write path; `recv` faults the response-read path
  // that the cancel is racing against. Both must settle without a leak/hang.
  test.each(["send", "recv"] as const)("body reader cancel under 1-byte %s settles cleanly", async syscall => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(Buffer.alloc(64 * 1024, "q")),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall, action: "short", bytes: 1, repeat: -1 },
      { abort: true, readBytes: 256 },
    );
    expect(r).toMatchObject({ ok: true, status: 200, signal: null, exitCode: 0 });
  });

  test("re-arming rules from JS during an in-flight fetch keeps the rule coherent", async () => {
    const body = Buffer.alloc(32 * 1024, "r");
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body) });
    // Regression: us_fault_set() published the rule with a plain struct write
    // while the HTTP-client thread read it concurrently in us_fault_hit(), so
    // a re-arm during a download could observe a torn rule. Hammer set() while
    // the body streams and require the bytes to still arrive intact. The clamp
    // floor of 8 keeps the syscall count bounded on slow ASan runners.
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      fault.set({ syscall: "recv", action: "short", bytes: 16, repeat: -1 });
      const done = fetch(${JSON.stringify(server.url.href)}).then(r => r.arrayBuffer());
      let flips = 0;
      const rearm = setInterval(() => {
        flips++;
        fault.set({ syscall: "recv", action: "short", bytes: 8 + (flips % 56), repeat: -1 });
        fault.set({ syscall: "send", action: "short", bytes: 8 + (flips % 8), repeat: -1 });
      }, 0);
      const buf = await done;
      clearInterval(rearm);
      fault.clear();
      console.log(JSON.stringify({ ok: true, length: buf.byteLength, flips }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Assert the output before the exit code so a failure shows what the fixture printed.
    expect(JSON.parse(stdout.trim() || "{}")).toMatchObject({ ok: true, length: body.length });
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(skip)("fetch() under injected syscall faults (https)", () => {
  test("TLS handshake under 3-byte sends still succeeds and body decrypts", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response("hello-tls"),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "send", action: "short", bytes: 3, repeat: -1 },
      { ca: certs.cert },
    );
    expect(r).toMatchObject({ ok: true, status: 200, length: 9, signal: null, exitCode: 0 });
  });

  test("recv → ECONNRESET during TLS handshake rejects (no hang)", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response("x"),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 },
      { ca: certs.cert },
    );
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  test("send → more bytes than it was given: rejects with ECONNRESET", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response("x"),
    });
    const r = await runClientFetch(server.url.href, { syscall: "send", action: "excess" }, { ca: certs.cert });
    expect(r).toMatchObject({ ok: false, code: "ECONNRESET", signal: null, exitCode: 0 });
  });

  test("recv → 5-byte short reads (TLS record header boundary) deliver complete body", async () => {
    const body = Buffer.alloc(2048, "T");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response(body),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "recv", action: "short", bytes: 5, repeat: -1 },
      { ca: certs.cert },
    );
    expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
  });
});

// A body with no Content-Length and no chunked framing ends at the FIN of the server. These are the
// deterministic twins of the resets in fetch-gzip.test.ts: a reset reaches the client as the errno of one
// call, and the fault puts that errno in a call of our choice.
describe.skipIf(skip)("fetch() of a close-delimited body under injected syscall faults", () => {
  // fetch() has this rule on Linux and Android. Elsewhere the body ends as before: the read has to settle.
  const cut = isLinux ? { ok: false, name: "TypeError", code: "ECONNRESET" } : {};
  const settled = { status: 200, signal: null, exitCode: 0 };

  // A send() that fails with ECONNRESET takes the reset out of the kernel: the recv() after it returns 0,
  // like a FIN. The body is not complete for that.
  test("send → ECONNRESET, then the FIN of the server: the body read rejects", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "ECONNRESET", repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true })).toMatchObject({ ...cut, ...settled });
  });

  // On Linux EPIPE says that the FIN of the server came before its reset. This passes without the rule too.
  test("send → EPIPE, then the FIN of the server: the whole body resolves", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "EPIPE", repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true })).toMatchObject({
      ok: true,
      length: "firstrest".length,
      ...settled,
    });
  });

  // Only ECONNRESET is the reset. A send() also fails for good with a timeout, and that can come after the
  // FIN of the server: the body is whole then.
  test("send → ETIMEDOUT, then the FIN of the server: the whole body resolves", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "ETIMEDOUT", repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true })).toMatchObject({
      ok: true,
      length: "firstrest".length,
      ...settled,
    });
  });

  // uSockets retries a send() whose errno is not in its list of "the peer is gone" (socket.c), so fetch()
  // does not see that errno. A cut whose errno such a send() took still ends like a FIN.
  test("outside the rule: send → ECONNREFUSED, then the FIN of the server: the body resolves", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "ECONNREFUSED", repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true })).toMatchObject({
      ok: true,
      length: "firstrest".length,
      ...settled,
    });
  });

  // uSockets rejects a send() that reports more bytes than it was given, and then closes the connection
  // itself (socket.c, loop.c). That close is not the FIN of the server either.
  test("send → more bytes than it was given: the body read rejects", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "excess", repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule)).toMatchObject({ ...cut, ...settled });
  });

  // An upload that is a Buffer goes out in its own calls of the client: the head with the start of the body,
  // then the rest of the body. 1 MiB is more than the first of the two takes.
  test("Buffer upload: send → ECONNRESET, then the FIN of the server: the body read rejects", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "ECONNRESET", after: 1, repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true, buffer: 1024 * 1024 })).toMatchObject({
      ...cut,
      ...settled,
    });
  });

  test("Buffer upload: send → EPIPE, then the FIN of the server: the whole body resolves", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "send", action: "errno", errno: "EPIPE", after: 1, repeat: 1 } as const;
    expect(await runUploadingFetch(server.url, rule, { askToEnd: true, buffer: 1024 * 1024 })).toMatchObject({
      ok: true,
      length: "firstrest".length,
      ...settled,
    });
  });

  test("recv → ECONNRESET after the first piece: the body read rejects", async () => {
    await using server = await serveInTwoPieces();
    const rule = { syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 } as const;
    expect(await runUploadingFetch(server.url, rule)).toMatchObject({ ...cut, ...settled });
  });

  // A TLS connection that had a send() rejected keeps the old rule. uSockets closes it with ECONNRESET
  // whatever the errno of that send() was, so the close does not say how the read side ended. These pass
  // without the rule too. The ECONNRESET rows are outside the rule: that send() met a reset with no FIN.
  //
  // uSockets sends a spilled record by itself, from the writable event.
  test.each(["ECONNRESET", "EPIPE"] as const)(
    "https: the send of a spilled record → %s: the body resolves",
    async errno => {
      await using server = await serveInTwoPieces(true);
      const rule = { syscall: "send", action: "errno", errno, repeat: 1 } as const;
      expect(await runUploadingFetch(server.url, rule, { ca: certs.cert, spill: true })).toMatchObject({
        ok: true,
        length: "first".length,
        ...settled,
      });
    },
  );

  // The send() of a chunk that TLS writes at once.
  test.each(["ECONNRESET", "EPIPE", "ETIMEDOUT"] as const)(
    "https: the send of a chunk → %s: the body resolves",
    async errno => {
      await using server = await serveInTwoPieces(true);
      const rule = { syscall: "send", action: "errno", errno, repeat: 1 } as const;
      expect(await runUploadingFetch(server.url, rule, { ca: certs.cert })).toMatchObject({
        ok: true,
        length: "first".length,
        ...settled,
      });
    },
  );

  // fetch() stops reading when 256 KiB of the body wait for a reader. It must not look for an error on the
  // socket at that moment: a read of SO_ERROR takes a reset that is pending, and the recv() after it then
  // returns 0, like a FIN. The client gets one byte for each recv() while the server writes the part of the
  // body that crosses that mark and resets, so the reset is pending when the client reaches the mark.
  test("a reset that is pending when fetch() stops reading: the body read rejects", async () => {
    await using server = await serveAcrossTheMark();
    expect(await runSlowReader(server.url)).toMatchObject({
      rounds: Array(3).fill({ ...cut, status: 200 }),
      signal: null,
      exitCode: 0,
    });
  });
});

describe.skipIf(skip)("fetch() seeded short-I/O fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x4e7c) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  test("randomized short recv/send still deliver intact body", async () => {
    const rand = makePrng(seed);
    const body = Buffer.alloc(4096, "F");
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body) });
    for (let i = 0; i < 4; i++) {
      const sc = rand() < 0.5 ? "recv" : "send";
      const bytes = 1 + Math.floor(rand() * 32);
      const r = await runClientFetch(server.url.href, { syscall: sc, action: "short", bytes, repeat: -1 });
      expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
    }
  });
});
