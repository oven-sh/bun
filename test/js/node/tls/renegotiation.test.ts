import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import type { IncomingMessage } from "http";
import { connect as netConnect } from "node:net";
import { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { join } from "path";
let url: URL;
let process: Subprocess<"ignore", "pipe", "ignore"> | null = null;
beforeAll(async () => {
  process = Bun.spawn(["node", join(import.meta.dir, "renegotiation-feature.js")], {
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...bunEnv,
      SERVER_CERT: tls.cert,
      SERVER_KEY: tls.key,
    },
  });
  const { value } = await process.stdout.getReader().read();
  url = new URL(new TextDecoder().decode(value));
});

afterAll(() => {
  process?.kill();
});

it("allow renegotiation in fetch", async () => {
  const body = await fetch(url, {
    verbose: true,
    keepalive: false,
    tls: { rejectUnauthorized: false },
  }).then(res => res.text());
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using fetch", async () => {
  try {
    await fetch(url, {
      verbose: true,
      keepalive: false,
      tls: { rejectUnauthorized: true },
    }).then(res => res.text());
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});

it("allow renegotiation in https module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: false,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  const body = await promise;
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using https", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: true,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});
it("allow renegotiation in tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: false,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  const body = await promise;
  expect(body).toBe("Hello World");
});

it("should not crash when socket is closed inside the renegotiation handshake callback", async () => {
  // When a TLS 1.2 server initiates renegotiation and then sends application data, the
  // client-side SSL_read loop fires the on_handshake callback once the renegotiated
  // handshake completes. If user code closes the socket inside that callback, the SSL*
  // is freed (s->ssl = NULL) and the loop must not continue into SSL_read(NULL, ...).
  // Run in a subprocess so a NULL-deref SIGSEGV shows up as a non-zero exit instead of
  // taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", renegotiationCloseInHandshakeFixture],
    env: {
      ...bunEnv,
      SERVER_HOST: url.hostname,
      SERVER_PORT: url.port,
      // If the subprocess segfaults in an ASAN build, symbolizing a ~1 GB
      // binary can take longer than the test timeout. We only need the exit
      // code / signal to assert that it did not crash.
      ASAN_OPTIONS: ((bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0").replace(/^:/, ""),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "ok",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
});

const renegotiationCloseInHandshakeFixture = /* js */ `
const { promise: done, resolve } = Promise.withResolvers();
let handshakes = 0;
const socket = await Bun.connect({
  hostname: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  tls: { rejectUnauthorized: false },
  socket: {
    open() {},
    data() {},
    error() {
      resolve();
    },
    close() {
      resolve();
    },
    handshake(socket) {
      handshakes++;
      if (handshakes === 1) {
        // Trigger the server's request handler so it initiates renegotiation
        // and writes application data once the renegotiated handshake completes.
        socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
      } else {
        // Second handshake = renegotiation completed. Closing here used to NULL
        // s->ssl while ssl_on_data's SSL_read loop was still running.
        socket.terminate();
        resolve();
      }
    },
  },
});
await done;
if (handshakes < 2) {
  throw new Error("expected renegotiation handshake callback to fire, got " + handshakes + " handshake(s)");
}
console.log("ok");
`;

// TLS 1.2 server that renegotiates right after the handshake WITHOUT sending
// any application data. The client finishes the renegotiated handshake with
// nothing to deliver, which is the path that used to leave the socket stuck
// in RENEGOTIATION_PENDING (no second handshake dispatch, no writable
// dispatch, and the close was misreported as a pre-handshake ECONNRESET). In
// "end" mode the server ends the socket once the renegotiation completes; in
// "pause" mode it stops reading, prints "reneg-done", and resumes when
// anything arrives on stdin.
const QUIET_RENEG_SERVER_JS = /* js */ `
  const tls = require("tls");
  const server = tls.createServer(
    {
      cert: process.env.SERVER_CERT,
      key: process.env.SERVER_KEY,
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
    },
    socket => {
      socket.on("error", () => {});
      socket.on("data", () => {});
      socket.renegotiate({ requestCert: true, rejectUnauthorized: false }, err => {
        if (err) process.exit(1);
        if (process.env.RENEG_MODE === "pause") {
          socket.pause();
          console.log("reneg-done");
          process.stdin.on("data", () => socket.resume());
        } else {
          socket.end();
        }
      });
    },
  );
  server.listen(0, () => console.log(server.address().port));
`;

function spawnQuietRenegotiationServer(mode: "end" | "pause") {
  return Bun.spawn({
    cmd: ["node", "-e", QUIET_RENEG_SERVER_JS],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "pipe",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key, RENEG_MODE: mode },
  });
}

type RenegServer = ReturnType<typeof spawnQuietRenegotiationServer>;

// stdout arrives in arbitrary chunks; accumulate until a full line is
// available.
function lineReader(proc: RenegServer) {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async function nextLine(): Promise<string> {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`server exited before printing a full line; buffered: ${JSON.stringify(buffered)}`);
      buffered += decoder.decode(value);
    }
  };
}

async function readPort(nextLine: () => Promise<string>) {
  const line = await nextLine();
  const port = Number(line);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`server printed an invalid port: ${JSON.stringify(line)}`);
  }
  return port;
}

it.concurrent(
  "should dispatch handshake success, not ECONNRESET, when renegotiation completes without app data",
  async () => {
    await using server = spawnQuietRenegotiationServer("end");
    const port = await readPort(lineReader(server));

    const events: unknown[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { rejectUnauthorized: false },
      socket: {
        open() {},
        data() {},
        handshake(_socket, success, authorizationError) {
          events.push({ success, code: (authorizationError as any)?.code ?? null });
        },
        error(_socket, err) {
          events.push({ error: (err as any)?.code ?? String(err) });
        },
        close() {
          resolve();
        },
      },
    });
    await closed;

    // One dispatch per completed handshake (initial + renegotiation), both with
    // the certificate verdict. The renegotiated session completed, so no
    // "disconnected before secure TLS connection was established" ECONNRESET.
    expect(events).toEqual([
      { success: true, code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      { success: true, code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    ]);
  },
);

it.concurrent("should re-emit secure/secureConnect after server-initiated renegotiation like node", async () => {
  await using server = spawnQuietRenegotiationServer("end");
  const port = await readPort(lineReader(server));

  // Node (verified against v26.3.0) emits 'secure' and 'secureConnect' once
  // per completed handshake, including the renegotiated one, and closes
  // cleanly with no error.
  const { promise, resolve } = Promise.withResolvers<{
    secure: number;
    secureConnect: number;
    errors: string[];
    hadError: boolean;
  }>();
  let secure = 0;
  let secureConnect = 0;
  const errors: string[] = [];
  const socket = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  socket.on("secure", () => secure++);
  socket.on("secureConnect", () => secureConnect++);
  socket.on("error", (e: any) => errors.push(e.code ?? e.message));
  socket.on("close", (hadError: boolean) => resolve({ secure, secureConnect, errors, hadError }));

  expect(await promise).toEqual({ secure: 2, secureConnect: 2, errors: [], hadError: false });
});

// While the handshake state was latched in RENEGOTIATION_PENDING, the
// writable path suppressed every drain dispatch, so a backpressured write's
// completion was lost until the peer happened to send data. Flood the paused
// server until the kernel buffers fill, then resume it and require the drain
// callback. Runs in a subprocess with a kill timeout so a regression (drain
// never delivered) cannot wedge the test runner.
const drainAfterRenegotiationFixture = /* js */ `
const server = Bun.spawn({
  cmd: ["node", "-e", process.env.SERVER_JS],
  stdout: "pipe",
  stderr: "inherit",
  stdin: "pipe",
  env: process.env,
});
const reader = server.stdout.getReader();
const decoder = new TextDecoder();
let buffered = "";
async function nextLine() {
  for (;;) {
    const newline = buffered.indexOf("\\n");
    if (newline !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      return line;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("server exited early; buffered: " + JSON.stringify(buffered));
    buffered += decoder.decode(value);
  }
}
const portLine = await nextLine();
const port = Number(portLine);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("server printed an invalid port: " + JSON.stringify(portLine));
}

// Drain also fires for earlier writable events (connect, handshake
// completion); only the one that completes the backpressured flood counts.
let awaitingDrain = false;
const { promise: drained, resolve: resolveDrained } = Promise.withResolvers();
// The renegotiation's own completion must dispatch the second handshake
// event: the server never sends app data and never closes, so nothing else
// can deliver it.
let handshakes = 0;
const { promise: renegotiated, resolve: resolveRenegotiated } = Promise.withResolvers();
// Rejected on socket failure so the awaits below fail fast instead of riding
// out the kill timeout; no-op once the scenario completed.
let finished = false;
const { promise: failed, reject: rejectFailed } = Promise.withResolvers();
failed.catch(() => {});
const socket = await Bun.connect({
  hostname: "127.0.0.1",
  port,
  tls: { rejectUnauthorized: false },
  socket: {
    open() {},
    data() {},
    handshake() {
      if (++handshakes === 2) resolveRenegotiated();
    },
    drain() {
      if (awaitingDrain) resolveDrained();
    },
    error(s, err) {
      if (!finished) rejectFailed(new Error("socket error before completion", { cause: err }));
    },
    close() {
      if (!finished) rejectFailed(new Error("socket closed before drain/renegotiation completed"));
    },
  },
});

// The server has completed the renegotiation and stopped reading.
const line = await nextLine();
if (line !== "reneg-done") throw new Error("expected reneg-done, got " + JSON.stringify(line));

// Write until the kernel send/receive buffers fill and the write is only
// partially accepted (or parked by a renegotiation still finishing on our
// side, which also reports a short write).
const chunk = Buffer.alloc(1 << 20, 120);
let backpressured = false;
for (let i = 0; i < 256; i++) {
  if (socket.write(chunk) < chunk.length) {
    backpressured = true;
    break;
  }
}
if (!backpressured) throw new Error("never hit backpressure");
awaitingDrain = true;

// Resuming the server drains the flood; the socket must report drain.
server.stdin.write("resume\\n");
await Promise.race([drained, failed]);
await Promise.race([renegotiated, failed]);
finished = true;
socket.terminate();
server.kill();
console.log("drained-ok");
`;

it.concurrent("should dispatch drain for a backpressured write after a quiet renegotiation", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", drainAfterRenegotiationFixture],
    env: {
      ...bunEnv,
      SERVER_JS: QUIET_RENEG_SERVER_JS,
      SERVER_CERT: tls.cert,
      SERVER_KEY: tls.key,
      RENEG_MODE: "pause",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "drained-ok",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
});

it.concurrent("should complete a quiet renegotiation over a duplex socket (SSLWrapper path)", async () => {
  // tls.connect({ socket: <Duplex> }) is encrypted by the SSLWrapper path
  // (UpgradedDuplex) rather than the uSockets C path. Its renegotiation state
  // machine had the same latch: a renegotiation finishing with no app data in
  // the same read pass never dispatched the second handshake event, so
  // 'secure' was not re-emitted until the peer sent something.
  await using server = spawnQuietRenegotiationServer("pause");
  const nextLine = lineReader(server);
  const port = await readPort(nextLine);

  const raw = netConnect(port, "127.0.0.1");
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());

  const { promise: renegotiated, resolve, reject } = Promise.withResolvers<void>();
  let secure = 0;
  const errors: string[] = [];
  raw.on("error", (e: any) =>
    reject(
      new Error(`raw socket failed before the second 'secure' (secure=${secure}, error=${e.code ?? e.message})`, {
        cause: e,
      }),
    ),
  );
  const socket = tlsConnect({ socket: duplex, rejectUnauthorized: false });
  socket.on("secure", () => {
    secure++;
    // One per completed handshake: initial + the quiet renegotiation. The
    // server sends no app data and no close, so only the renegotiation's own
    // completion can deliver the second event.
    if (secure === 2) resolve();
  });
  socket.on("error", (e: any) => errors.push(e.code ?? e.message));
  socket.on("close", () =>
    reject(new Error(`closed before the second 'secure' (secure=${secure}, errors=${JSON.stringify(errors)})`)),
  );

  try {
    await renegotiated;
    expect(errors).toEqual([]);
  } finally {
    socket.destroy();
    raw.destroy();
  }
});

it.concurrent("should not re-dispatch the handshake when teardown cuts a renegotiation mid-flight (SSLWrapper path)", async () => {
  // On a quiet connection the first client-to-server write after the first
  // 'secure' can only be the renegotiation ClientHello (the client answers
  // the server's HelloRequest; it has no app data to send). Dropping it and
  // destroying the raw socket guarantees teardown runs while the wrapper is
  // mid-renegotiation, which used to re-dispatch a bogus handshake event.
  await using server = spawnQuietRenegotiationServer("pause");
  const nextLine = lineReader(server);
  const port = await readPort(nextLine);

  const events: string[] = [];
  let secure = 0;
  let cut = false;
  const raw = netConnect(port, "127.0.0.1");
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      if (secure >= 1 && !cut) {
        cut = true;
        queueMicrotask(() => raw.destroy());
        callback();
        return;
      }
      if (cut) {
        callback();
        return;
      }
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => {
    if (!cut) duplex.push(chunk);
  });
  // Deliberately no raw 'end' -> push(null) forwarding: teardown must arrive
  // via the duplex 'close' thunk alone so the wrapper's fast shutdown runs
  // mid-renegotiation with the TLS socket's handlers still attached.
  raw.on("close", () => duplex.destroy());

  const { promise: closed, resolve } = Promise.withResolvers<void>();
  const socket = tlsConnect({ socket: duplex, rejectUnauthorized: false });
  socket.on("secure", () => {
    secure++;
    events.push(`secure#${secure}`);
  });
  socket.on("secureConnect", () => events.push("secureConnect"));
  socket.on("error", (e: any) => events.push(`error:${e.code ?? e.message}`));
  socket.on("close", (hadError: boolean) => {
    events.push(`close(hadError=${hadError})`);
    resolve();
  });
  await closed;

  // Exactly one dispatch for the initial handshake; a renegotiation cut
  // mid-flight must not produce a duplicate secureConnect/secure.
  expect(events).toEqual(["secureConnect", "secure#1", "close(hadError=false)"]);
});

it("should terminate the connection when the peer exceeds the renegotiation limit over a duplex socket", async () => {
  // tls.connect({ socket: <Duplex> }) is encrypted by the SSLWrapper path
  // (UpgradedDuplex) rather than the uSockets C path. It must apply the same
  // per-connection renegotiation cap: a malicious TLS 1.2 server that spams
  // HelloRequest messages otherwise forces a full handshake each time
  // (unbounded CPU per connection).
  await using attacker = Bun.spawn({
    cmd: [
      "node",
      "-e",
      `
        const tls = require("tls");
        let renegs = 0;
        const server = tls.createServer(
          {
            cert: process.env.SERVER_CERT,
            key: process.env.SERVER_KEY,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.2",
          },
          socket => {
            socket.on("error", () => {});
            const again = () => {
              if (renegs >= 10) {
                socket.write("DONE");
                return;
              }
              socket.renegotiate({ rejectUnauthorized: false }, err => {
                if (err) return;
                renegs++;
                again();
              });
            };
            again();
          },
        );
        server.listen(0, () => console.log(server.address().port));
      `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
  const { value } = await attacker.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).trim());

  const net = require("net");
  const { Duplex } = require("stream");
  const raw = net.connect(port, "127.0.0.1");
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());

  const { promise: outcome, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = require("tls").connect({ socket: duplex, rejectUnauthorized: false });
  socket.on("data", (chunk: Buffer) => {
    received += chunk.toString();
    if (received.includes("DONE")) resolve("got-response");
  });
  socket.on("error", () => {});
  socket.on("close", () => resolve("closed"));

  // The SSLWrapper must tear the connection down once the peer exceeds the
  // renegotiation limit, before the attacker finishes its 10 renegotiations
  // and delivers the response.
  expect(await outcome).toBe("closed");
});

it("should fail if renegotiation fails using tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: true,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});
