import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as COMMON_CERT } from "harness";
import constants from "node:constants";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";

// node:tls server 'newSession' / 'resumeSession' are the documented hooks for
// an external TLS session cache. Session-ID-based, so servers fire them only
// for TLS <= 1.2 without tickets (BoringSSL's TLS 1.3 server is stateless).
test("tls.Server emits 'newSession' and 'resumeSession' for session-ID resumption", async () => {
  const cache = new Map<string, Buffer>();
  const events: string[] = [];
  // Switches the 'resumeSession' reply between synchronous and asynchronous:
  // both drive the suspended handshake through a different native path.
  let asyncResume = false;

  const server = tls.createServer({
    key: COMMON_CERT.key,
    cert: COMMON_CERT.cert,
    maxVersion: "TLSv1.2",
    // Disable tickets so the client offers a real session_id on reconnect
    // and the server consults the external cache.
    secureOptions: constants.SSL_OP_NO_TICKET,
  });
  server.on("newSession", (id, data, cb) => {
    events.push("newSession");
    expect(Buffer.isBuffer(id)).toBe(true);
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(id.length).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof cb).toBe("function");
    cache.set(id.toString("hex"), data);
    cb();
  });
  server.on("resumeSession", (id, cb) => {
    events.push("resumeSession");
    expect(Buffer.isBuffer(id)).toBe(true);
    expect(id.length).toBeGreaterThan(0);
    expect(typeof cb).toBe("function");
    const hit = cache.get(id.toString("hex")) ?? null;
    if (asyncResume) setImmediate(() => cb(null, hit));
    else cb(null, hit);
  });
  server.on("secureConnection", s => {
    events.push("secureConnection");
    s.end("ok");
  });
  server.on("tlsClientError", err => events.push("tlsClientError:" + err?.message));

  const { promise: listening, resolve: onListen, reject: onListenErr } = Promise.withResolvers<void>();
  server.on("error", onListenErr);
  server.listen(0, "127.0.0.1", onListen);
  await listening;
  const port = (server.address() as AddressInfo).port;
  try {
    // First connection: full handshake, the server mints a resumable session.
    const session1 = await connectOnce(port, undefined);
    // Node emits newSession (the external-cache store) BEFORE secureConnection.
    expect(events).toEqual(["newSession", "secureConnection"]);
    expect(session1).toBeInstanceOf(Buffer);

    events.length = 0;
    // Second connection offering the session_id: 'resumeSession' resolves the
    // external-cache lookup SYNCHRONOUSLY with the stored session, so the
    // handshake is a resumption and no new session is minted.
    expect(await connectOnce(port, session1)).toBe(true);
    expect(events).toEqual(["resumeSession", "secureConnection"]);

    // Third connection: the same lookup resolved ASYNCHRONOUSLY (the real
    // external-cache shape). The handshake stays suspended across the tick
    // and still resumes.
    asyncResume = true;
    events.length = 0;
    expect(await connectOnce(port, session1)).toBe(true);
    expect(events).toEqual(["resumeSession", "secureConnection"]);
  } finally {
    server.close();
  }
});

test("tls.Server defers secureConnection until the async 'newSession' callback and handles a cache miss", async () => {
  let newSessionCount = 0;
  let resumeSessionCount = 0;
  const order: string[] = [];

  const server = tls.createServer({
    key: COMMON_CERT.key,
    cert: COMMON_CERT.cert,
    maxVersion: "TLSv1.2",
    secureOptions: constants.SSL_OP_NO_TICKET,
  });
  server.on("newSession", (_id, _data, cb) => {
    newSessionCount++;
    // Asynchronous external store. Node holds the connection's
    // secureConnection until the done callback runs, so the cache is
    // populated before the connection is usable.
    setImmediate(() => {
      order.push("newSessionDone");
      cb();
    });
  });
  server.on("resumeSession", (_id, cb) => {
    resumeSessionCount++;
    // Asynchronous external-cache miss.
    setImmediate(() => cb(null, null));
  });
  server.on("secureConnection", s => {
    order.push("secureConnection");
    s.end("ok");
  });

  const { promise: listening, resolve: onListen, reject: onListenErr } = Promise.withResolvers<void>();
  server.on("error", onListenErr);
  server.listen(0, "127.0.0.1", onListen);
  await listening;
  const port = (server.address() as AddressInfo).port;
  try {
    const session1 = await connectOnce(port, undefined);
    expect(newSessionCount).toBe(1);
    // secureConnection was HELD until the 'newSession' done callback.
    expect(order).toEqual(["newSessionDone", "secureConnection"]);

    // Offer the session but have the cache "miss": the server still
    // completes a full handshake and mints a fresh session.
    const reused = await connectOnce(port, session1);
    expect(resumeSessionCount).toBe(1);
    expect(newSessionCount).toBe(2);
    expect(reused).toBe(false);
  } finally {
    server.close();
  }
});

// The split-out repro: listeners attached and a default-version (TLS 1.3)
// client. BoringSSL's TLS 1.3 server is stateless, so the session-ID cache
// hooks must never fire; assert that to pin the documented no-op contract.
test("tls.Server session-cache listeners are inert for a TLS 1.3 client", async () => {
  let secure = 0;
  let newSession = 0;
  let resumeSession = 0;
  const server = tls.createServer({ key: COMMON_CERT.key, cert: COMMON_CERT.cert });
  server.on("newSession", (_id, _data, cb) => {
    newSession++;
    cb();
  });
  server.on("resumeSession", (_id, cb) => {
    resumeSession++;
    cb(null, null);
  });
  server.on("secureConnection", s => {
    secure++;
    s.end("ok");
  });

  const { promise: listening, resolve: onListen, reject: onListenErr } = Promise.withResolvers<void>();
  server.on("error", onListenErr);
  server.listen(0, "127.0.0.1", onListen);
  await listening;
  const port = (server.address() as AddressInfo).port;
  try {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const c = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, resolve);
    c.on("error", reject);
    c.on("close", hadError => reject(new Error(`socket closed before secureConnect (hadError=${hadError})`)));
    c.resume();
    await promise;
    const closed = once(c, "close");
    c.end();
    await closed;
    expect({ secure, newSession, resumeSession }).toEqual({ secure: 1, newSession: 0, resumeSession: 0 });
  } finally {
    server.close();
  }
});

// A 'resumeSession' callback that replies with a truthy non-Buffer (a Redis
// client without return_buffers hands back a string) must behave like Node's
// loadSession: treated as a cache miss, never a wedged handshake.
test("tls.Server treats a non-Buffer 'resumeSession' reply as a cache miss", async () => {
  let newSession = 0;
  let resumeSession = 0;

  const server = tls.createServer({
    key: COMMON_CERT.key,
    cert: COMMON_CERT.cert,
    maxVersion: "TLSv1.2",
    secureOptions: constants.SSL_OP_NO_TICKET,
  });
  server.on("newSession", (_id, _data, cb) => {
    newSession++;
    cb();
  });
  server.on("resumeSession", (_id, cb) => {
    resumeSession++;
    // Asynchronously reply with the session bytes as a STRING, not a Buffer.
    setImmediate(() => cb(null, "definitely not a Buffer"));
  });
  server.on("secureConnection", s => s.end("ok"));

  const { promise: listening, resolve: onListen, reject: onListenErr } = Promise.withResolvers<void>();
  server.on("error", onListenErr);
  server.listen(0, "127.0.0.1", onListen);
  await listening;
  const port = (server.address() as AddressInfo).port;
  try {
    const session1 = await connectOnce(port, undefined);
    expect(session1).toBeInstanceOf(Buffer);
    // The non-Buffer reply is a miss: the second handshake completes as a
    // FULL handshake (mints a fresh session) instead of hanging forever.
    const reused = await connectOnce(port, session1);
    expect({ reused, newSession, resumeSession }).toEqual({
      reused: false,
      newSession: 2,
      resumeSession: 1,
    });
  } finally {
    server.close();
  }
});

// A throwing 'newSession' listener must not leave the deferred
// 'secureConnection' pending; Node surfaces the throw as an uncaughtException.
// Subprocess: an uncaughtException (even handled) fails the test runner.
test("a throwing 'newSession' listener completes the handshake and surfaces the throw", async () => {
  const script = `
    const tls = require("node:tls");
    const constants = require("node:constants");
    const out = [];
    process.on("uncaughtException", e => out.push("uncaught:" + e.message));
    const server = tls.createServer({
      key: process.env.TLS_KEY,
      cert: process.env.TLS_CERT,
      maxVersion: "TLSv1.2",
      secureOptions: constants.SSL_OP_NO_TICKET,
    });
    server.on("newSession", () => {
      out.push("newSession");
      throw new Error("newSession listener boom");
    });
    server.on("secureConnection", s => { out.push("secureConnection"); s.end("ok"); });
    server.listen(0, "127.0.0.1", () => {
      const c = tls.connect({
        port: server.address().port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        maxVersion: "TLSv1.2",
        secureOptions: constants.SSL_OP_NO_TICKET,
      });
      c.on("error", e => out.push("clientError:" + e.message));
      // An extra tick so the server's nextTick-raised uncaughtException has run.
      c.on("close", () => process.nextTick(() => {
        console.log(JSON.stringify(out));
        server.close();
      }));
      c.resume();
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TLS_KEY: COMMON_CERT.key, TLS_CERT: COMMON_CERT.cert },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Without the recovery nothing is printed and the child hangs. toSorted():
  // 'secureConnection' and the re-raised throw land on different turns. stderr
  // only excludes the throw (debug/ASAN builds emit benign warnings there).
  expect({ out: JSON.parse(stdout.trim()).toSorted(), stderr, exitCode }).toEqual({
    out: ["newSession", "secureConnection", "uncaught:newSession listener boom"].toSorted(),
    stderr: expect.not.stringContaining("boom"),
    exitCode: 0,
  });
});

// Same contract for a throwing 'resumeSession' listener: the suspended lookup
// must resolve as a miss (the second leg still completes as a FULL handshake)
// and the throw must surface as an uncaughtException. Subprocess: same reason.
test("a throwing 'resumeSession' listener completes the handshake and surfaces the throw", async () => {
  const script = `
    const tls = require("node:tls");
    const constants = require("node:constants");
    const out = [];
    let newSessions = 0;
    process.on("uncaughtException", e => out.push("uncaught:" + e.message));
    const server = tls.createServer({
      key: process.env.TLS_KEY,
      cert: process.env.TLS_CERT,
      maxVersion: "TLSv1.2",
      secureOptions: constants.SSL_OP_NO_TICKET,
    });
    server.on("newSession", (_id, _data, cb) => { out.push("newSession:" + ++newSessions); cb(); });
    server.on("resumeSession", () => {
      out.push("resumeSession");
      throw new Error("resumeSession listener boom");
    });
    server.on("secureConnection", s => { out.push("secureConnection"); s.end("ok"); });
    server.listen(0, "127.0.0.1", () => {
      const opts = {
        port: server.address().port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        maxVersion: "TLSv1.2",
        secureOptions: constants.SSL_OP_NO_TICKET,
      };
      const first = tls.connect(opts);
      first.on("error", e => out.push("clientError1:" + e.message));
      let session = null;
      first.on("session", s => { session = s; });
      first.resume();
      // Registered unconditionally so a first leg that errors or closes
      // before minting a session still prints + exits (a failed multiset
      // assertion in the parent) instead of hanging until the suite timeout.
      first.on("close", () => {
        if (!session) {
          out.push("noSession");
          console.log(JSON.stringify(out));
          server.close();
          return;
        }
        // Offer the minted session_id: 'resumeSession' fires and throws.
        const second = tls.connect({ ...opts, session });
        second.on("error", e => out.push("clientError2:" + e.message));
        second.on("secureConnect", () => out.push("reused:" + second.isSessionReused()));
        second.resume();
        // An extra tick so the nextTick-raised uncaughtException has run.
        second.on("close", () => process.nextTick(() => {
          console.log(JSON.stringify(out));
          server.close();
        }));
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TLS_KEY: COMMON_CERT.key, TLS_CERT: COMMON_CERT.cert },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // 'newSession:2' + 'reused:false' prove the throwing lookup resolved as a
  // real miss (a fresh full handshake, not a wedge), and 'uncaught:...' that
  // the throw surfaced instead of routing to the no-op error handler.
  expect({ out: JSON.parse(stdout.trim()).toSorted(), stderr, exitCode }).toEqual({
    out: [
      "newSession:1",
      "secureConnection",
      "resumeSession",
      "uncaught:resumeSession listener boom",
      "newSession:2",
      "reused:false",
      "secureConnection",
    ].toSorted(),
    stderr: expect.not.stringContaining("boom"),
    exitCode: 0,
  });
});

// A server-side TLSSocket over a generic Duplex drives TLS through the
// in-process SSL wrapper, which has no handshake-suspension/resume path. A
// TLS 1.2 session_id offer must fall through to a full handshake, not wedge.
test("server-side TLSSocket over a generic duplex survives a TLS 1.2 session-id reconnect", async () => {
  const context = tls.createSecureContext({ key: COMMON_CERT.key, cert: COMMON_CERT.cert });
  const rawServer = net.createServer(conn => {
    // Wrap the accepted socket in a plain Duplex that hides its native handle
    // so tls.TLSSocket must drive TLS over the stream rather than adopting
    // the fd.
    const passthrough = new Duplex({
      read() {
        conn.resume();
      },
      write(chunk, _enc, cb) {
        conn.write(chunk, cb);
      },
      final(cb) {
        conn.end(cb);
      },
    });
    conn.on("data", d => {
      if (!passthrough.push(d)) conn.pause();
    });
    conn.on("end", () => passthrough.push(null));
    conn.on("error", e => passthrough.destroy(e));
    const secure = new tls.TLSSocket(passthrough, { isServer: true, secureContext: context });
    secure.on("secure", () => secure.end("ok"));
    secure.on("error", () => conn.destroy());
  });

  const { promise: listening, resolve: onListen, reject: onListenErr } = Promise.withResolvers<void>();
  rawServer.on("error", onListenErr);
  rawServer.listen(0, "127.0.0.1", onListen);
  await listening;
  const port = (rawServer.address() as AddressInfo).port;
  try {
    // TLS 1.2 with tickets disabled on the CLIENT too, so the second
    // ClientHello carries a real session_id and no ticket extension: exactly
    // the input that reaches the server's session-id lookup.
    const session1 = await connectOnce(port, undefined);
    expect(session1).toBeInstanceOf(Buffer);
    // This is the connection that would hang if the lookup suspended.
    const reused = await connectOnce(port, session1);
    expect(typeof reused).toBe("boolean");
  } finally {
    rawServer.close();
  }
});

// One TLS 1.2 client round-trip. On the FIRST connection (no `session`),
// resolves with the serialized session the server issued; on a RESUMING
// connection, resolves with `isSessionReused()`.
async function connectOnce(port: number, session: Buffer | undefined): Promise<any> {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  const c = tls.connect(
    {
      port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      maxVersion: "TLSv1.2",
      // Do not offer the session_ticket extension: a server that cannot issue
      // tickets then mints a session-ID-based session on the first connect,
      // and consults the session-id lookup on the second.
      secureOptions: constants.SSL_OP_NO_TICKET,
      session,
    },
    () => {
      if (session) resolve(c.isSessionReused());
    },
  );
  c.on("session", s => {
    if (!session) resolve(s);
  });
  c.on("error", reject);
  // A clean peer teardown before the awaited condition must FAIL the test
  // immediately, not hang it until the test timeout.
  c.on("close", hadError =>
    reject(
      new Error(`socket closed before ${session ? "secureConnect" : "the 'session' event"} (hadError=${hadError})`),
    ),
  );
  c.resume();
  const result = await promise;
  const closed = once(c, "close");
  c.end();
  await closed;
  return result;
}
