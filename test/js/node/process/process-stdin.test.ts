import { expect, test } from "bun:test";
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
test.skipIf(!isPosix)("SIGTERM is delivered with flowing stdin on /dev/zero", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      process.on("SIGTERM", () => {
        fs.writeSync(2, "SIGTERM\\n");
        process.exit(42);
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
  // listener. Sending SIGTERM before the handler is installed hits the
  // default disposition (terminate) and the handler never runs.
  const readyPromise = (async () => {
    const reader = proc.stdout.getReader();
    let seen = "";
    while (!seen.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) return false;
      seen += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    return true;
  })();
  expect(await readyPromise).toBe(true);

  proc.kill("SIGTERM");
  const exitCode = await proc.exited;
  expect(exitCode).toBe(42);
  expect(await proc.stderr.text()).toContain("SIGTERM");
});

test.skipIf(!isPosix)("SIGINT is delivered with flowing stdin on /dev/zero", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      process.on("SIGINT", () => {
        fs.writeSync(2, "SIGINT\\n");
        process.exit(43);
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

  const reader = proc.stdout.getReader();
  let seen = "";
  while (!seen.includes("READY")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  expect(seen).toContain("READY");

  proc.kill("SIGINT");
  const exitCode = await proc.exited;
  expect(exitCode).toBe(43);
  expect(await proc.stderr.text()).toContain("SIGINT");
});

// Timer callbacks must fire too: the same read-loop stall froze setInterval.
test.skipIf(!isPosix)("setInterval fires with flowing stdin on /dev/zero", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      let ticks = 0;
      process.on("SIGTERM", () => {
        fs.writeSync(1, "ticks=" + ticks + "\\n");
        process.exit(44);
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
  const reader = proc.stdout.getReader();
  let seen = "";
  while (!seen.includes("TICKED")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  expect(seen).toContain("TICKED");

  proc.kill("SIGTERM");
  const exitCode = await proc.exited;
  expect(exitCode).toBe(44);
});
