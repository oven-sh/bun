import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Evicting a custom SSL context while it still has in-flight sockets must not
// leave socket_async_http_abort_tracker pointing at freed sockets (the next
// drainQueuedShutdowns UAF'd). The fixture fills the cache past
// SSL_CONTEXT_CACHE_MAX_SIZE (60, HTTPThread.rs) with distinct TLS configs
// whose handshakes hang against a local server that never replies, so every
// entry has an active socket when the 61st+ config evicts the oldest.
// Aborting everything then drains the tracker.
//
// In release builds the UAF only faulted once the freed slot was reused; the
// fixture spams refused connects (same size class) to make that likely, and
// the test runs the fixture several times.
test("aborting fetches whose custom SSL context was evicted does not crash", async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }),
  );

  for (const { stdout, stderr, exitCode } of results) {
    expect({ stdout, exitCode, stderrTail: exitCode === 0 ? "" : stderr.slice(-2000) }).toEqual({
      stdout: "ok",
      exitCode: 0,
      stderrTail: "",
    });
  }
});

const fixture = /* js */ `
const N = 65; // > SSL_CONTEXT_CACHE_MAX_SIZE (60)

// TLS handshakes against this server hang forever: it accepts the TCP
// connection and never writes, so every fetch stays active (handshaking).
let opened = 0;
const allConnected = Promise.withResolvers();
const hangServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open() {
      if (++opened === N) allConnected.resolve();
    },
    data() {},
  },
});

// Grab a port that refuses connections: bind, then close the listener.
const refusedListener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {} } });
const refusedPort = refusedListener.port;
refusedListener.stop(true);

const controllers = [];
const promises = [];

// Phase 1: 65 distinct TLS configs. The 61st+ trigger evictOldestSslContext
// while every cache entry still has an active in-flight socket.
for (let i = 0; i < N; i++) {
  const ac = new AbortController();
  controllers.push(ac);
  promises.push(
    fetch("https://127.0.0.1:" + hangServer.port + "/", {
      signal: ac.signal,
      tls: { serverName: "host" + i + ".test" },
    }).catch(() => {})
  );
}
// Every request has reached the server, so all 65 contexts exist and each
// has an active socket registered with the abort tracker.
await allConnected.promise;

// Phase 2: refused connects allocate (and promptly free) connecting sockets
// in the same size class, so the evicted entries' freed slots get reused
// before the aborts below — that's what made the pre-fix UAF actually fault.
const spam = [];
for (let i = 0; i < 200; i++) {
  spam.push(fetch("http://127.0.0.1:" + refusedPort + "/").catch(() => {}));
}
await Promise.all(spam);

// Abort everything — drainQueuedShutdowns walks the tracker.
for (const ac of controllers) ac.abort();
await Promise.all(promises);
hangServer.stop(true);

console.log("ok");
`;

// At process exit (BUN_DESTRUCT_VM_ON_EXIT=1, the ASAN/LSan CI mode),
// dealloc_in_flight_for_exit releases each in-flight client's
// custom-SSL-context ref. For a context already evicted from the cache that
// deref is the LAST one: HTTPContext::drop must not close_all() mid-teardown —
// dispatching into the half-torn-down (or already freed) clone is a UAF and
// double-frees the ThreadlocalAsyncHttp box.
test("exiting with in-flight fetches on evicted custom SSL contexts does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", exitFixture],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, stderrTail: exitCode === 0 ? "" : stderr.slice(-2000) }).toEqual({
    stdout: "ok",
    exitCode: 0,
    stderrTail: "",
  });
});

const exitFixture = /* js */ `
const N = 65; // > SSL_CONTEXT_CACHE_MAX_SIZE (60): the oldest entries get evicted

let opened = 0;
const allConnected = Promise.withResolvers();
const hangServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open() {
      if (++opened === N) allConnected.resolve();
    },
    data() {},
  },
});

for (let i = 0; i < N; i++) {
  fetch("https://127.0.0.1:" + hangServer.port + "/", {
    tls: { serverName: "host" + i + ".test" },
  }).catch(() => {});
}
// The server never replies, so once every request has connected all N are
// still in flight — exit now, with the oldest contexts already evicted.
await allConnected.promise;
console.log("ok");
process.exit(0);
`;
