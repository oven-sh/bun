import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// A `redis+unix://` path with no listener makes `connect()` fail synchronously
// (inside the `.connect()` call itself) instead of via a deferred socket error.
// A synchronous `connect()` failure used to leave the cached `connectionPromise`
// in a state nothing would ever repair:
//   1. a later `.connect()` returned the stale rejected promise and never retried
//   2. once a later connection attempt (started by any command) progressed,
//      `on_valkey_connect` / `on_valkey_close` settled that same promise again:
//        ASSERTION FAILED: arg0->status() == JSC::JSPromise::Status::Pending
//        void JSC__JSPromise__reject(JSC::JSPromise*, JSGlobalObject*, EncodedJSValue)
//        src/jsc/bindings/bindings.cpp:3733
//   3. on the reconnect paths the promise simply never settled
// Each case runs in its own process because the second settle aborts the whole
// process under ASSERT-enabled builds.

// Minimal Redis-ish unix-socket server: frames complete RESP arrays
// (*N\r\n followed by N bulk strings) and replies +OK to each. +OK is a valid
// HELLO reply, so the client reaches the connected state without a real Redis.
const SERVER_TS = /* ts */ `
  function consumeRespArray(buf) {
    if (buf.length < 4 || buf[0] !== 0x2a /* '*' */) return 0;
    let eol = buf.indexOf("\\r\\n");
    if (eol < 0) return 0;
    const count = parseInt(buf.subarray(1, eol).toString("latin1"), 10);
    let off = eol + 2;
    for (let i = 0; i < count; i++) {
      if (off >= buf.length || buf[off] !== 0x24 /* '$' */) return 0;
      eol = buf.indexOf("\\r\\n", off);
      if (eol < 0) return 0;
      const len = parseInt(buf.subarray(off + 1, eol).toString("latin1"), 10);
      off = eol + 2 + len + 2;
      if (off > buf.length) return 0;
    }
    return off;
  }

  export function listenRespOk(unix) {
    return Bun.listen({
      unix,
      socket: {
        open(socket) {
          socket.data = { buf: Buffer.alloc(0) };
        },
        data(socket, chunk) {
          socket.data.buf = Buffer.concat([socket.data.buf, chunk]);
          let consumed;
          while ((consumed = consumeRespArray(socket.data.buf)) > 0) {
            socket.data.buf = socket.data.buf.subarray(consumed);
            socket.write("+OK\\r\\n");
          }
        },
        error() {},
      },
    });
  }
`;

async function run(name: string, reproTs: string) {
  using dir = tempDir(name, { "server.ts": SERVER_TS, "repro.ts": reproTs });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // `stderr` is not asserted (ASAN/debug builds emit benign noise); it is
  // passed as expect()'s failure message so the aborting assertion is visible.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

test.skipIf(isWindows).concurrent("RedisClient.connect() retries after a synchronous connect failure", async () => {
  const { stdout, stderr, exitCode, signalCode } = await run(
    "vk-retry",
    /* ts */ `
        import { RedisClient } from "bun";
        import { join } from "node:path";
        import { listenRespOk } from "./server.ts";
        const sock = join(import.meta.dir, "s");
        const client = new RedisClient(\`redis+unix://\${sock}\`);
        // No listener at \`sock\` yet: connect(2) on the unix path fails synchronously.
        const first = await client.connect().then(() => "resolved", (e) => e?.code);
        const wasConnected = client.connected;
        // The target exists now. connect() must start a new attempt rather than
        // hand back the promise it already rejected above.
        const server = listenRespOk(sock);
        const second = await client.connect().then((v) => v, (e) => e?.code);
        console.log(JSON.stringify({ first, wasConnected, second, connected: client.connected }));
        client.close();
        server.stop(true);
      `,
  );
  expect({ stdout, exitCode, signalCode }, stderr).toEqual({
    stdout: JSON.stringify({
      first: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION",
      wasConnected: false,
      second: "OK",
      connected: true,
    }),
    exitCode: 0,
    signalCode: null,
  });
});

// on_valkey_connect re-reads the cached connectionPromise once the handshake
// finishes. If the failed connect() left its rejected promise in the slot, this
// resolves it a second time.
test
  .skipIf(isWindows)
  .concurrent("a later successful connection does not settle the stale connectionPromise", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(
      "vk-resolve",
      /* ts */ `
        import { RedisClient } from "bun";
        import { join } from "node:path";
        import { listenRespOk } from "./server.ts";
        const sock = join(import.meta.dir, "s");
        const client = new RedisClient(\`redis+unix://\${sock}\`);
        const first = await client.connect().then(() => "resolved", (e) => e?.code);
        const server = listenRespOk(sock);
        // .get() reconnects via a path that does not consult the cached slot, so
        // the connection proceeds and on_valkey_connect settles the slot.
        const got = await client.get("k");
        console.log(JSON.stringify({ first, got }));
        client.close();
        server.stop(true);
      `,
    );
    expect({ stdout, exitCode, signalCode }, stderr).toEqual({
      stdout: JSON.stringify({ first: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION", got: "OK" }),
      exitCode: 0,
      signalCode: null,
    });
  });

// do_connect's second connect path: once a client has connected (so
// needs_to_open_socket is false), a later .connect() routes through
// reconnect(). Its synchronous connect() failure used to be swallowed into the
// onclose callback, leaving the cached connectionPromise pending forever, so
// .connect() hung and every later .connect() returned the same stale promise.
test.skipIf(isWindows).concurrent("connect() rejects when a synchronous reconnect attempt fails", async () => {
  const { stdout, stderr, exitCode, signalCode } = await run(
    "vk-reconnect",
    /* ts */ `
        import { RedisClient } from "bun";
        import { join } from "node:path";
        import { listenRespOk } from "./server.ts";
        const sock = join(import.meta.dir, "s");
        // Connect successfully first so the next connect() takes the
        // reconnect() path rather than the needs_to_open_socket one.
        const server = listenRespOk(sock);
        const client = new RedisClient(\`redis+unix://\${sock}\`, { autoReconnect: false });
        const first = await client.connect().then((v) => v, (e) => e?.code);
        // Drop the server and wait for the client to observe the close.
        server.stop(true);
        while (client.connected) await new Promise((r) => setImmediate(r));
        // Nothing listens at \`sock\` anymore: connect(2) fails synchronously
        // inside reconnect(), and the promise must still settle.
        const second = await client.connect().then(() => "resolved", (e) => e?.code);
        console.log(JSON.stringify({ first, second }));
      `,
  );
  expect({ stdout, exitCode, signalCode }, stderr).toEqual({
    stdout: JSON.stringify({ first: "OK", second: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION" }),
    exitCode: 0,
    signalCode: null,
  });
});

// The third connect path: on_close()'s auto-reconnect branch schedules
// on_reconnect_timer without ever reaching on_valkey_close(), so the .connect()
// promise is still cached when the timer fires. If reconnect()'s connect(2)
// then fails synchronously, that promise must still settle.
test
  .skipIf(isWindows)
  .concurrent("connect() rejects when the auto-reconnect timer's attempt fails synchronously", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(
      "vk-reconnect-timer",
      /* ts */ `
        import { rmSync } from "node:fs";
        import { RedisClient } from "bun";
        import { join } from "node:path";
        import { listenRespOk } from "./server.ts";
        const sock = join(import.meta.dir, "s");
        const server = listenRespOk(sock);
        // connectionTimeout: 0 disables the connection-timeout timer so the
        // process can exit naturally once the promise settles.
        const client = new RedisClient(\`redis+unix://\${sock}\`, { connectionTimeout: 0 });
        const pending = client.connect().then(() => "resolved", (e) => e?.code);
        // Kill the target in the same tick, before the handshake can complete.
        // The socket close takes the auto-reconnect branch; the reconnect timer
        // then retries connect(2) against a path that no longer exists.
        server.stop(true);
        rmSync(sock, { force: true });
        console.log(JSON.stringify({ first: await pending }));
      `,
    );
    expect({ stdout, exitCode, signalCode }, stderr).toEqual({
      stdout: JSON.stringify({ first: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION" }),
      exitCode: 0,
      signalCode: null,
    });
  });

// on_valkey_close also re-reads the cached connectionPromise. close() while a
// later attempt is still mid-connect rejects the stale promise a second time
// (the JSC__JSPromise__reject half of the assertion).
test
  .skipIf(isWindows)
  .concurrent("close() during a later connection attempt does not reject the stale connectionPromise", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(
      "vk-reject",
      /* ts */ `
        import { RedisClient } from "bun";
        import { join } from "node:path";
        import { listenRespOk } from "./server.ts";
        const sock = join(import.meta.dir, "s");
        const client = new RedisClient(\`redis+unix://\${sock}\`);
        const first = await client.connect().then(() => "resolved", (e) => e?.code);
        const server = listenRespOk(sock);
        // Start a fresh connection via .get(), then close before it completes.
        const pending = client.get("k").then(() => "resolved", (e) => e?.code);
        client.close();
        const got = await pending;
        console.log(JSON.stringify({ first, got }));
        server.stop(true);
      `,
    );
    expect({ stdout, exitCode, signalCode }, stderr).toEqual({
      stdout: JSON.stringify({ first: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION", got: "ERR_REDIS_CONNECTION_CLOSED" }),
      exitCode: 0,
      signalCode: null,
    });
  });
