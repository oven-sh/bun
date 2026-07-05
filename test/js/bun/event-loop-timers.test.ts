// uSockets' us_timer_t no longer exists on epoll/kqueue: everything that used
// to need one now schedules on Bun's own event-loop timer heap. On Linux that
// means the process must not hold a single timerfd, no matter how much of the
// runtime is spun up. It used to hold four: the JS thread's socket-timeout
// sweep plus its two GC timers, and one more sweep on the HTTP client thread.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

const COUNT_TIMERFDS = /* js */ `
  function countTimerFds() {
    const { readdirSync, readlinkSync } = require("fs");
    let n = 0;
    for (const fd of readdirSync("/proc/self/fd")) {
      let link;
      try { link = readlinkSync("/proc/self/fd/" + fd); } catch { continue; }
      if (link.startsWith("anon_inode:[timerfd]")) n++;
    }
    return n;
  }
`;

async function countTimerFdsIn(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", COUNT_TIMERFDS + body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

test.concurrent.skipIf(process.platform !== "linux")("idle runtime holds no timerfd", async () => {
  // Allocating churns the heap, which is what arms the GC controller's timers.
  const { stdout, stderr, exitCode } = await countTimerFdsIn(`
    for (let i = 0; i < 100; i++) new Uint8Array(4096);
    console.log(countTimerFds());
  `);
  expect(stdout).toBe("0");
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(process.platform !== "linux")(
  "a live server, the HTTP client thread, and JS timers hold no timerfd",
  async () => {
    const { stdout, stderr, exitCode } = await countTimerFdsIn(`
      using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      // fetch() spins up the HTTP client thread, which owns a second uws loop
      // and therefore a second socket-timeout sweep.
      const res = await fetch(server.url);
      if ((await res.text()) !== "ok") throw new Error("bad response");
      const interval = setInterval(() => {}, 10);
      const timeout = setTimeout(() => {}, 60_000);
      await Bun.sleep(1);
      console.log(countTimerFds());
      clearInterval(interval);
      clearTimeout(timeout);
    `);
    expect(stdout).toBe("0");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

// The sweep that expires idle sockets used to ride on that timerfd. It is now a
// deadline folded into the epoll/kqueue wait, so prove it still fires. uSockets'
// sweep granularity is 4 seconds (LIBUS_TIMEOUT_GRANULARITY), which is the floor
// on how fast this can be observed — hence the explicit budget, matching the
// idleTimeout tests in test/js/bun/http/serve.test.ts.
test.concurrent(
  "Bun.serve idleTimeout still expires an idle connection",
  async () => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 1,
      fetch: () => new Response("ok"),
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await Bun.connect({
      hostname: server.hostname,
      port: server.port,
      socket: {
        // An incomplete request line: the server never replies, so the sweep is
        // the only thing that can close this connection.
        open: socket => void socket.write("GET / HTT"),
        close: () => resolve("closed"),
        error: (_socket, err) => reject(err),
        connectError: (_socket, err) => reject(err),
        data: () => reject(new Error("server should not have responded")),
      },
    });

    expect(await promise).toBe("closed");
  },
  30_000,
);

// The GC controller's timers live on the same heap as the `WTFTimer` nodes that
// `~RunLoop::Timer` frees during JSC teardown, so they have to be unlinked
// before it runs. Under `BUN_DESTRUCT_VM_ON_EXIT` that teardown actually
// happens, and getting the order wrong is a use-after-free in the pairing heap.
test.concurrent.skipIf(!isASAN)("destructing the VM on exit does not corrupt the timer heap", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `setTimeout(() => {}, 1); await Bun.sleep(5); console.log("ok");`],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.trim(),
    asan: stderr.includes("AddressSanitizer") ? stderr.slice(0, 400) : null,
    signalCode: proc.signalCode ?? null,
    exitCode,
  }).toEqual({ stdout: "ok", asan: null, signalCode: null, exitCode: 0 });
});
