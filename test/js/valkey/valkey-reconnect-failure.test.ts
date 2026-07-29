import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";

// A previously-authenticated client that was closed used to keep
// `is_authenticated` set. If a later connect() then failed synchronously (the
// unix socket is gone, or socket() hits EMFILE), the client ended up
// Disconnected with `failed` cleared but `connection_ready()` still true, and
// the next non-pipelined command fell into `enqueue()`'s `_ => unreachable!()`
// arm and aborted the process.
//
// The fixture uses a unix socket so the reconnect's connect(2) fails
// synchronously (ENOENT) once the socket file is removed.
const FIXTURE = /* ts */ `
  import { join } from "node:path";

  const mode = process.argv[2];
  const sock = join(import.meta.dir, "valkey.sock");

  // Minimal RESP mock: +OK to every inbound frame (HELLO handshake + commands).
  function listen() {
    return Bun.listen({
      unix: sock,
      socket: {
        open() {},
        data(s) {
          s.write("+OK\\r\\n");
        },
        error() {},
        close() {},
        drain() {},
      },
    });
  }

  let srv = listen();

  const options =
    mode === "send"
      ? { autoReconnect: false }
      : mode === "no-pipelining"
        ? { autoReconnect: false, enableAutoPipelining: false }
        : {};

  const client = new Bun.RedisClient("redis+unix://" + sock, options);
  await client.connect();
  await client.set("k", "v");
  console.log("connected", client.connected);

  client.close();
  console.log("closed", client.connected);

  // Unlinks the unix socket, so the next connect(2) fails with ENOENT.
  srv.stop(true);

  const connectPromise = client.connect();

  if (mode === "recover") {
    // autoReconnect (default) retries with backoff; bring the server back so
    // the retry succeeds and the offline queue drains.
    srv = listen();
    const reply = client.send("INFO", []);
    console.log("reply", await reply);
    await connectPromise;
    console.log("reconnected", client.connected);
    srv.stop(true);
  } else {
    const command = mode === "no-pipelining" ? client.incr("n") : client.send("INFO", []);
    const [connectResult, commandResult] = await Promise.allSettled([connectPromise, command]);
    console.log("connect", connectResult.status, connectResult.reason?.code);
    console.log("command", commandResult.status, commandResult.reason?.code, commandResult.reason?.message);
  }
`;

async function runFixture(mode: string) {
  using dir = tempDir("valkey-reconn", { "reconnect-fixture.ts": FIXTURE });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "reconnect-fixture.ts", mode],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr, exitCode };
}

describe.skipIf(isWindows)("RedisClient after a synchronously failing reconnect", () => {
  const rejected = [
    "connected true",
    "closed false",
    "connect rejected ERR_REDIS_CONNECTION_CLOSED",
    "command rejected ERR_REDIS_CONNECTION_CLOSED Connection has failed",
  ].join("\n");

  test.concurrent("non-pipelined command rejects instead of aborting the process", async () => {
    const { stdout, stderr, exitCode } = await runFixture("send");
    expect({ stdout, exitCode }, stderr).toEqual({ stdout: rejected, exitCode: 0 });
  });

  test.concurrent("enableAutoPipelining: false rejects instead of aborting the process", async () => {
    const { stdout, stderr, exitCode } = await runFixture("no-pipelining");
    expect({ stdout, exitCode }, stderr).toEqual({ stdout: rejected, exitCode: 0 });
  });

  test.concurrent("autoReconnect retries with backoff and drains the offline queue", async () => {
    const { stdout, stderr, exitCode } = await runFixture("recover");
    expect({ stdout, exitCode }, stderr).toEqual({
      stdout: ["connected true", "closed false", "reply OK", "reconnected true"].join("\n"),
      exitCode: 0,
    });
  });
});

async function runInline(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), stderr, exitCode, signalCode: proc.signalCode };
}

// After auto-reconnect exhausts maxRetries and the client fails, the stale
// `is_reconnecting` flag used to keep the event loop referenced forever, so
// the process never exited.
test.concurrent("process exits after auto-reconnect exhausts maxRetries", async () => {
  const { stdout, stderr, exitCode, signalCode } = await runInline(/* ts */ `
    const srv = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {},
        data(s) {
          s.write("+OK\\r\\n");
        },
        error() {},
        close() {},
        drain() {},
      },
    });
    const client = new Bun.RedisClient("redis://127.0.0.1:" + srv.port, { maxRetries: 1 });
    await client.set("k", "v");
    console.log("connected", client.connected);
    const pending = client.get("k");
    srv.stop(true);
    const results = await Promise.allSettled([pending, client.get("k")]);
    console.log(results.map(r => r.status + " " + r.reason?.code).join("|"));
  `);
  expect({ stdout, exitCode, signalCode }, stderr).toEqual({
    stdout: ["connected true", "rejected ERR_REDIS_CONNECTION_CLOSED|rejected ERR_REDIS_CONNECTION_CLOSED"].join("\n"),
    exitCode: 0,
    signalCode: null,
  });
});

// https://github.com/oven-sh/bun/issues/18895
// When connectionTimeout fired between reconnect attempts the socket was
// already detached, so fail()'s close() was a no-op and no close callback ever
// settled the connect() promise or released the event loop.
test.concurrent("connectionTimeout during a reconnect backoff settles connect() and exits", async () => {
  const { stdout, stderr, exitCode, signalCode } = await runInline(/* ts */ `
    // Bind and release a port so nothing is listening on it.
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = probe.port;
    probe.stop(true);
    const client = new Bun.RedisClient("redis://127.0.0.1:" + port, { connectionTimeout: 500 });
    const results = await Promise.allSettled([client.connect(), client.get("k")]);
    console.log(results.map(r => r.status + " " + r.reason?.code + " " + r.reason?.message).join("|"));
  `);
  expect({ stdout, exitCode, signalCode }, stderr).toEqual({
    stdout: [
      "rejected ERR_REDIS_CONNECTION_CLOSED Connection closed",
      "rejected ERR_REDIS_CONNECTION_TIMEOUT Connection timeout reached after 500ms",
    ].join("|"),
    exitCode: 0,
    signalCode: null,
  });
});
