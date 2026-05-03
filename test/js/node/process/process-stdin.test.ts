import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

test("pipe does the right thing", async () => {
  // Note: Bun.spawnSync uses memfd_create on Linux for pipe, which means we see
  // it as a file instead of a tty
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect((await new Response(result.stdout).text()).trim()).toBe("function");
  expect(await result.exited).toBe(0);
});

test("file does the right thing", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await result.stdout.text()).toMatchInlineSnapshot(`
    "undefined
    "
  `);
  expect(await result.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(await result.exited).toBe(0);
});

test("stdin with 'readable' event handler should receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleReadable = () => {
        let chunk;
        while ((chunk = process.stdin.read())) {
          console.log("got chunk", JSON.stringify(chunk));
        }
      };
      
      process.stdin.on("readable", handleReadable);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  await proc.exited;

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "got chunk {"type":"Buffer","data":[97,98,99,10,100,101,102,10]}
    "
  `);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(1);
});

test("stdin with 'data' event handler should NOT receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleData = chunk => {
        console.log("got chunk");
      };
      
      process.stdin.on("data", handleData);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(1);
});

test("stdin should allow process to exit when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.stdin.on("data", () => {});
        process.stdin.pause();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(0);
});

test("stdin should not allow process to exit when not paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdin.on("data", () => {});
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await Bun.sleep(1000);
  expect(proc.exitCode).toBe(null);
  proc.kill();
  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
});

// https://github.com/oven-sh/bun/issues/30189
// Signal handlers must fire even when process.stdin has a flowing 'data'
// listener on a non-pollable character device (/dev/zero, /dev/urandom, ...).
// Previously, onPull drove `reader.read()` synchronously for non-pollable
// fds, so the `onPull -> resolve -> await -> push -> _read -> onPull` loop
// stayed inside a microtask chain and never yielded to the event loop.
// `Bun__onPosixSignal` kept enqueuing into the signal ring, but
// `tickConcurrentWithCount` never ran to drain it.
//
// Parameterized across SIGTERM/SIGINT/SIGUSR1/SIGUSR2 — a break that only
// affected one signal type would sneak through single-signal coverage.
describe.skipIf(!isPosix)("signals with flowing stdin on /dev/zero", () => {
  describe.each([
    { signal: "SIGTERM", exit: 42 },
    { signal: "SIGINT", exit: 43 },
    { signal: "SIGUSR1", exit: 44 },
    { signal: "SIGUSR2", exit: 45 },
  ] as const)("$signal", ({ signal, exit }) => {
    // Timeout is deliberately tight: on regression the child's event loop
    // is wedged in the synchronous read loop and neither waitpid nor the
    // signal handler resolves, so we want each case to fail fast instead
    // of eating 5s and truncating the rest of the suite's output.
    test("handler fires", async () => {
      // await using: on regression the child is a CPU-bound infinite
      // /dev/zero reader. An early expect() throw has to still terminate
      // the subprocess or we leak a busy-looping process into the rest
      // of the run.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          // Order matters: without the fix, `process.stdin.on("data")`
          // synchronously enters the blocking read loop, so any writes
          // that come AFTER it never flush. Emit READY and install the
          // signal handler FIRST, then attach the listener that arms
          // the bug. The readiness ping proves the child got far enough
          // to have the handler registered before we send the signal.
          `
            const fs = require("fs");
            process.on(${JSON.stringify(signal)}, () => {
              fs.writeSync(2, ${JSON.stringify(signal)} + "\\n");
              process.exit(${exit});
            });
            fs.writeSync(1, "READY\\n");
            process.stdin.on("data", () => {});
            `,
        ],
        stdin: Bun.file("/dev/zero"),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      // Wait for READY so the child has definitely installed the signal
      // handler before we kill it. READY precedes the data listener that
      // arms the regression — on regression the child still prints
      // READY, proc.kill delivers via the default disposition, and the
      // tail assertions surface that the JS handler never ran.
      await waitForLine(proc, "READY");

      proc.kill(signal);

      // stderr first: on regression the child is killed by the default
      // disposition, exitCode is null and stderr is empty — asserting
      // stderr first surfaces `expected "" to contain "SIGTERM"`, which
      // points at the real cause (handler never fired).
      expect(await proc.stderr.text()).toContain(signal);
      expect(await proc.exited).toBe(exit);
    }, // 5s timeout: debug-build subprocess startup is ~1s on its own, and
    // READY takes another ~0.5-1s. Tight timeouts made the suite flaky.
    5000);
  });

  // Timer callbacks share the same starvation path — setInterval stalled
  // whenever tick() never returned.
  test("setInterval fires", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // Same ordering as above: handler + timer first, then READY,
        // then the data listener that arms the bug. The interval emits
        // TICKED on its first tick so the parent can synchronize on an
        // observed condition instead of a wall-clock delay — on
        // regression the event loop is wedged and TICKED never arrives,
        // so waitForLine() fails deterministically.
        `
          const fs = require("fs");
          let ticked = false;
          process.on("SIGTERM", () => {
            fs.writeSync(1, "SAW_SIGTERM\\n");
            process.exit(46);
          });
          setInterval(() => {
            if (!ticked) {
              ticked = true;
              fs.writeSync(1, "TICKED\\n");
            }
          }, 10);
          fs.writeSync(1, "READY\\n");
          process.stdin.on("data", () => {});
          `,
      ],
      stdin: Bun.file("/dev/zero"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Timer must fire at least once while stdin is flowing. waitForLine
    // throws on EOF so a child that dies before ticking surfaces as a
    // clear startup failure rather than a later assertion mismatch.
    await waitForLine(proc, "TICKED");
    proc.kill("SIGTERM");

    // Confirm the SIGTERM handler fired (not just the default
    // disposition) by checking the handler's distinctive marker.
    const stdout = await proc.stdout.text();
    expect(stdout).toContain("SAW_SIGTERM");
    expect(await proc.exited).toBe(46);
  }, 5000);
});

// waitForLine reads from proc.stdout until `needle` appears. Throws on EOF
// so a child that dies before writing the marker fails the test with a
// useful diagnostic instead of letting callers continue against a corpse.
// Releases the lock in a finally so `await using` disposal can still drain.
async function waitForLine(proc: Bun.Subprocess, needle: string): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  try {
    while (!seen.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(
          `stdout ended before ${JSON.stringify(needle)} was seen; output so far: ${JSON.stringify(seen)}`,
        );
      }
      seen += decoder.decode(value);
    }
  } finally {
    reader.releaseLock();
  }
  return seen;
}
