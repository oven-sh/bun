import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

// https://github.com/oven-sh/bun/issues/32400
// A custom SIGINT handler that cleans up a ref'd resource used to hang the
// --watch/--hot run-loop forever: the handler ran, the event loop drained, but
// the watcher kept the process alive. It should exit like a plain `bun run`
// (and like `node --watch`) once the loop drains after the signal.
describe.each(["--watch", "--hot"])("%s exits on SIGINT after the handler cleans up", flag => {
  it.skipIf(isWindows)("issue #32400", async () => {
    using dir = tempDir("watch-sigint", {
      "serve.ts": `
        const server = Bun.serve({ port: 0, fetch() { return new Response("OK"); } });
        process.on("SIGINT", async () => {
          await server.stop();
          console.log("CLEANED_UP");
        });
        console.log("READY");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", flag, "serve.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain stderr concurrently so the watch banner can't fill the pipe.
    const stderrDone = proc.stderr.text();

    // Wait until the server is up and the SIGINT handler is installed.
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    let ready = false;
    while (!ready) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
      if (stdout.includes("READY")) ready = true;
    }
    reader.releaseLock();
    expect(ready).toBe(true);

    process.kill(proc.pid, "SIGINT");

    // On the fixed build the handler stops the server, the loop drains and the
    // process exits. On the buggy build the --watch/--hot loop blocks forever,
    // so this await hangs and the test times out (the fail-before state). The
    // handler caught SIGINT, so the exit is clean (code 0, no signalCode), not
    // a signal kill.
    const exitCode = await proc.exited;
    const stderr = await stderrDone;

    // Surface stderr (watch banner + any crash output) if the process didn't
    // exit cleanly, so a regression shows the cause rather than just a code.
    if (exitCode !== 0) {
      expect(stderr).toBe("");
    }
    expect(proc.signalCode).toBe(null);
    expect(exitCode).toBe(0);
  });
});

// https://github.com/oven-sh/bun/issues/32400 (same class, `bun test --watch`)
// A preload that installs a custom SIGINT handler and cleans up a ref'd
// resource used to hang the test-watch keep-alive loop after Ctrl+C, the same
// way `bun run --watch` did. It should exit once the loop drains.
it.skipIf(isWindows)("bun test --watch exits on SIGINT after the handler cleans up", async () => {
  using dir = tempDir("test-watch-sigint", {
    "setup.ts": `
      const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
      process.on("SIGINT", async () => {
        await server.stop();
        console.log("CLEANED_UP");
      });
    `,
    "noop.test.ts": `
      import { test, expect } from "bun:test";
      test("noop", () => { expect(1).toBe(1); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--watch", "--preload", "./setup.ts", "./noop.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // `bun test` prints results to stderr; the first run finishing ("Ran ...")
  // means the watcher is now idle. Drain both streams so neither pipe blocks,
  // and resolve readiness when the marker appears (or the stream ends early).
  const stdoutDone = proc.stdout.text();
  const decoder = new TextDecoder();
  let stderr = "";
  const { promise: ranReady, resolve: onRan } = Promise.withResolvers<void>();
  const stderrDone = (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes("Ran ")) onRan();
      }
    } finally {
      reader.releaseLock();
      onRan();
    }
  })();

  await ranReady;
  expect(stderr).toContain("Ran ");

  process.kill(proc.pid, "SIGINT");

  // On the buggy build the test-watch loop blocks forever here; the handler
  // caught SIGINT, so a clean exit is code 0 with no signalCode.
  const exitCode = await proc.exited;
  await Promise.all([stdoutDone, stderrDone]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(proc.signalCode).toBe(null);
  expect(exitCode).toBe(0);
});

// Same class, but for a SIGINT delivered *during* the test run (before the
// watcher loop is entered): the handler runs and the loop drains first, so the
// loop must not park on the keep-alive timer when it is finally entered.
// Sending the signal from inside a test makes the timing deterministic.
it.skipIf(isWindows)("bun test --watch exits on a SIGINT delivered during the run", async () => {
  using dir = tempDir("test-watch-sigint-midrun", {
    "setup.ts": `process.on("SIGINT", () => { console.log("GOT_SIGINT"); });`,
    "sigint.test.ts": `
      import { test } from "bun:test";
      test("sends SIGINT to itself mid-run", () => {
        process.kill(process.pid, "SIGINT");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--watch", "--preload", "./setup.ts", "./sigint.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // On the buggy build the leading keep-alive call parks here: the signal was
  // already handled and the loop already drained, so nothing wakes it. A clean
  // exit is code 0 with no signalCode. Drain both pipes alongside `exited` so a
  // full pipe can't stall the child.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout).toContain("GOT_SIGINT");
  expect(proc.signalCode).toBe(null);
  expect(exitCode).toBe(0);
});
