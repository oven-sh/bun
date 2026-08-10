import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import os from "node:os";
import {
  BUSY_LOOP,
  cdpClient,
  connectInspector,
  countBanners,
  debugProcess,
  hasBanner,
  IDLE,
  readStreamToEnd,
  readStreamUntil,
  spawnTarget,
  waitForBanner,
  withTimeout,
  wsUrlFromBanner,
} from "./helpers";

// `process._debugProcess(pid)` is the cross-platform entry point: SIGUSR1 on
// POSIX, a named file mapping + CreateRemoteThread on Windows. Everything here
// runs on every platform; SIGUSR1-specific semantics live in the -posix file.
describe.concurrent("process._debugProcess", () => {
  test("activates the inspector in an idle target", async () => {
    const { proc, pid } = await spawnTarget(IDLE);
    await using _ = proc;

    await debugProcess(pid);
    const stderr = await waitForBanner(proc);

    expect(stderr).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("activates the inspector in a target stuck in while(true)", async () => {
    const { proc, pid } = await spawnTarget(BUSY_LOOP);
    await using _ = proc;

    await debugProcess(pid);
    const stderr = await waitForBanner(proc);

    expect(stderr).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("does not activate a second inspector", async () => {
    const { proc, pid } = await spawnTarget(IDLE);
    await using _ = proc;

    await debugProcess(pid);
    const reader = proc.stderr.getReader();
    let stderr = await readStreamUntil(reader, hasBanner);

    await debugProcess(pid);
    // A CDP round trip proves the target's event loop has turned since the
    // second request was delivered, so a second banner would be visible by now.
    const ws = await connectInspector(wsUrlFromBanner(stderr));
    try {
      const result = await cdpClient(ws)("Runtime.evaluate", { expression: "6 * 7" });
      expect(result.result.result.value).toBe(42);
    } finally {
      ws.close();
    }

    proc.kill();
    stderr = await readStreamToEnd(reader, stderr);
    reader.releaseLock();

    expect(countBanners(stderr)).toBe(1);
  });

  test("CDP works after a client reconnects", async () => {
    const { proc, pid } = await spawnTarget(IDLE);
    await using _ = proc;

    await debugProcess(pid);
    const url = wsUrlFromBanner(await waitForBanner(proc));

    for (const [expression, expected] of [
      ["1 + 1", 2],
      ["2 + 3", 5],
    ] as const) {
      const ws = await connectInspector(url);
      try {
        const result = await cdpClient(ws)("Runtime.evaluate", { expression });
        expect(result.result.result.value).toBe(expected);
      } finally {
        const closed = new Promise<void>(resolve => (ws.onclose = () => resolve()));
        ws.close();
        await withTimeout("websocket close", closed);
      }
    }
  });

  test("Debugger.pause interrupts while(true)", async () => {
    const { proc, pid } = await spawnTarget(BUSY_LOOP);
    await using _ = proc;

    await debugProcess(pid);
    const ws = await connectInspector(wsUrlFromBanner(await waitForBanner(proc)));
    try {
      const paused = Promise.withResolvers<any>();
      const send = cdpClient(ws, msg => {
        if (msg.method === "Debugger.paused") paused.resolve(msg);
      });

      await send("Runtime.enable");
      await send("Debugger.enable");
      await send("Debugger.pause");
      const event = await withTimeout("Debugger.paused event", paused.promise);
      expect(event.method).toBe("Debugger.paused");

      await send("Debugger.resume");
    } finally {
      ws.close();
    }
  });

  test("rejects a missing pid", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { process._debugProcess(); } catch (e) { console.log(e.code); }`],
      env: bunEnv,
      stdout: "pipe",
    });
    expect(await proc.stdout.text()).toBe("ERR_MISSING_ARGS\n");
  });

  test("rejects pids that are not positive int32s", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `for (const pid of [0, -1, 1.5, 2 ** 32 + 1]) {
           try { process._debugProcess(pid); console.log(pid, "no error"); } catch (e) { console.log(pid, e.code); }
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
    });
    expect(await proc.stdout.text()).toMatchInlineSnapshot(`
      "0 ERR_INVALID_ARG_VALUE
      -1 ERR_INVALID_ARG_VALUE
      1.5 ERR_INVALID_ARG_TYPE
      4294967297 ERR_INVALID_ARG_TYPE
      "
    `);
  });

  test.skipIf(isWindows)("reports kill() failures as system errors", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { process._debugProcess(2147483646); } catch (e) { console.log(e.code, e.syscall); }`],
      env: bunEnv,
      stdout: "pipe",
    });
    expect(await proc.stdout.text()).toBe("ESRCH kill\n");
  });

  // Node throws a plain Error carrying the Win32 message here; the vendored
  // test/js/node/test/parallel/test-debug-process.js checks the exact text.
  test.skipIf(!isWindows)("reports a missing target with the Win32 message", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { process._debugProcess(2147483646); } catch (e) { console.log(e.message); }`],
      env: bunEnv,
      stdout: "pipe",
    });
    expect(await proc.stdout.text()).toBe("The system cannot find the file specified.\n");
  });
});

describe.skipIf(isWindows).concurrent("--disable-sigusr1", () => {
  test("leaves SIGUSR1 at its default action", async () => {
    const { proc, pid } = await spawnTarget(IDLE, ["--disable-sigusr1"]);
    await using _ = proc;

    process.kill(pid, "SIGUSR1");
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Exit status of a signal death. Bun's signalCode lookup reports macOS's
    // SIGUSR1 (30) under the Linux name for 30, so compare numerically.
    expect({ exitCode, banners: countBanners(stderr) }).toEqual({
      exitCode: 128 + os.constants.signals.SIGUSR1,
      banners: 0,
    });
  });
});
