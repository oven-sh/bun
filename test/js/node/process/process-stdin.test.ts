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
async function waitForLine(proc: Bun.Subprocess, needle: string): Promise<string> {
  const reader = proc.stdout.getReader();
  let seen = "";
  try {
    while (!seen.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
  } finally {
    reader.releaseLock();
  }
  return seen;
}

// Parameterized across SIGTERM/SIGINT/SIGUSR1/SIGUSR2 — a break that only
// affected one signal type would sneak through single-signal coverage.
describe.skipIf(!isPosix)("signals with flowing stdin on /dev/zero", () => {
  const cases = [
    { signal: "SIGTERM", exit: 42 },
    { signal: "SIGINT", exit: 43 },
    { signal: "SIGUSR1", exit: 44 },
    { signal: "SIGUSR2", exit: 45 },
  ] as const;

  test.each(cases)("$signal handler fires", async ({ signal, exit }) => {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        process.on(${JSON.stringify(signal)}, () => {
          fs.writeSync(2, ${JSON.stringify(signal)} + "\\n");
          process.exit(${exit});
        });
        process.stdin.on("data", () => {});
        fs.writeSync(1, "READY\\n");
        `,
      ],
      stdin: Bun.file("/dev/zero"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Wait for the child to finish registering the signal handler + data
    // listener. Sending the signal before the handler is installed would hit
    // the default disposition (terminate) and the handler would never run.
    expect(await waitForLine(proc, "READY")).toContain("READY");

    proc.kill(signal);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(exit);
    expect(await proc.stderr.text()).toContain(signal);
  });

  // Timer callbacks share the same starvation path — setInterval stalled
  // whenever tick() never returned.
  test("setInterval fires", async () => {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        let ticks = 0;
        process.on("SIGTERM", () => {
          fs.writeSync(1, "ticks=" + ticks + "\\n");
          process.exit(46);
        });
        setInterval(() => {
          ticks++;
          if (ticks === 3) fs.writeSync(1, "TICKED\\n");
        }, 10);
        process.stdin.on("data", () => {});
        fs.writeSync(1, "READY\\n");
        `,
      ],
      stdin: Bun.file("/dev/zero"),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Wait for the timer to tick at least 3 times — proves setInterval is
    // firing despite the flowing stdin read loop.
    expect(await waitForLine(proc, "TICKED")).toContain("TICKED");

    proc.kill("SIGTERM");
    const exitCode = await proc.exited;
    expect(exitCode).toBe(46);
  });
});
