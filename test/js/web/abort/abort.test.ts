import { describe, expect, test } from "bun:test";
import { watch, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("AbortSignal", () => {
  test("spawn test", async () => {
    const fileName = `/abort.test.ts`;
    const testFileContents = await Bun.file(join(import.meta.dir, "abort.ts")).arrayBuffer();

    writeFileSync(join(tmpdirSync(), fileName), testFileContents, "utf8");
    const { stderr } = Bun.spawnSync({
      cmd: [bunExe(), "test", fileName],
      env: bunEnv,
      cwd: tmpdir(),
    });

    expect(stderr?.toString()).not.toContain("✗");
  });

  test("AbortSignal.timeout(n) should not freeze the process", async () => {
    const fileName = join(import.meta.dir, "abort.signal.ts");

    await using server = Bun.spawn({
      cmd: [bunExe(), fileName],
      env: bunEnv,
      cwd: tmpdir(),
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(await server.exited).toBe(0);
  });

  // The per-element TypeError is thrown inside forEachInIterable's callback.
  // Without a RETURN_IF_EXCEPTION after the loop, AbortSignal::any(...) still
  // runs: a dependent signal is created and wired to any valid sources that
  // appeared before the bad element, and the wrapper is returned with the
  // TypeError still pending. Under GC pressure that pending exception was seen
  // to be consumed so the caller received a live signal instead of a throw.
  test("AbortSignal.any() rejects a non-AbortSignal element without allocating a dependent signal", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const c = new AbortController();
      Bun.gc(true);
      const before = heapStats().objectTypeCounts.AbortSignal ?? 0;
      let threw = 0;
      let returned = 0;
      const N = 256;
      for (let i = 0; i < N; i++) {
        try {
          const r = AbortSignal.any([c.signal, 1]);
          returned += r instanceof AbortSignal ? 1 : 0;
        } catch (e) {
          threw += e?.code === "ERR_INVALID_ARG_TYPE" ? 1 : 0;
        }
      }
      const ghosts = (heapStats().objectTypeCounts.AbortSignal ?? 0) - before;
      process.stdout.write(JSON.stringify({ threw, returned, ghosts, N }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect({ threw: out.threw, returned: out.returned }).toEqual({ threw: out.N, returned: 0 });
    // Without the exception check the count here is exactly N.
    expect(out.ghosts).toBeLessThan(out.N / 4);
    expect(exitCode).toBe(0);
  });

  test("AbortSignal.any() should fire abort event", async () => {
    async function testAny(signalToAbort: number) {
      const { promise, resolve } = Promise.withResolvers();

      const a = new AbortController();
      const b = new AbortController();
      // @ts-ignore
      const signal = AbortSignal.any([a.signal, b.signal]);
      const timeout = setTimeout(() => {
        resolve(false);
      }, 100);

      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve(true);
      });

      if (signalToAbort) {
        b.abort();
      } else {
        a.abort();
      }

      expect(await promise).toBe(true);
      expect(signal.aborted).toBe(true);
    }

    await testAny(0);
    await testAny(1);
  });

  function fmt(value: any) {
    const res = {};
    for (const key in value) {
      res[key] = value[key];
    }
    return res;
  }

  test(".signal.reason should be a DOMException", () => {
    const ac = new AbortController();
    ac.abort();
    expect(ac.signal.reason).toBeInstanceOf(DOMException);
    expect(fmt(ac.signal.reason)).toEqual(fmt(new DOMException("The operation was aborted.", "AbortError")));
    expect(ac.signal.reason.code).toBe(20);
  });
  test(".signal.reason should be a DOMException for timeout", async () => {
    const ac = AbortSignal.timeout(0);
    await Bun.sleep(10);
    expect(ac.reason).toBeInstanceOf(DOMException);
    expect(fmt(ac.reason)).toEqual(fmt(new DOMException("The operation timed out.", "TimeoutError")));
    expect(ac.reason.code).toBe(23);
  });

  // #33334: with nothing else ref'd, uv_run() skipped its body on Windows so
  // uv__run_timers never ran and the whole file hung. Subprocess so a
  // regression is an attributable failure, not a file-level timeout.
  test("awaiting AbortSignal.timeout(n) abort event with nothing else ref'd does not hang (#33334)", async () => {
    using dir = tempDir("abort-33334", {
      "timeout.test.ts": `import { expect, test } from "bun:test";
        test("AbortSignal.timeout fires", async () => {
          const signal = AbortSignal.timeout(1);
          const { promise, resolve } = Promise.withResolvers<Event>();
          signal.addEventListener("abort", resolve, { once: true });
          await promise;
          expect(signal.aborted).toBe(true);
        });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "timeout.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr: stderr.includes("1 pass") ? "1 pass" : stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stderr: "1 pass",
      exitCode: 0,
      signalCode: null,
    });
  });

  // https://wpt.fyi/results/dom/abort/timeout.any.html "AbortSignal timeouts fire in order"
  test("AbortSignal.timeout with equal deadlines fire in creation order", async () => {
    const src = `
      const order = [];
      const done = Promise.withResolvers();
      let remaining = 7;
      const tick = v => { order.push(v); if (--remaining === 0) done.resolve(); };
      for (let i = 0; i < 6; i++) {
        const s = AbortSignal.timeout(5);
        s.onabort = () => tick(i);
      }
      // setTimeout with the same delay is a reference: it already fires in
      // creation order, and these signals should sort alongside it.
      setTimeout(() => tick("t"), 5);
      await done.promise;
      console.log(JSON.stringify(order));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim())).toEqual([0, 1, 2, 3, 4, 5, "t"]);
    expect(exitCode).toBe(0);
  });
});

// https://dom.spec.whatwg.org/#dom-abortsignal-timeout: a timeout signal aborts
// once its deadline passes for as long as the signal exists. Whether anything
// was listening in the meantime only matters for GC, never for whether it fires.
// The native timer used to be cancelled as soon as the signal's listener count
// dropped to zero, leaving a signal the program still held stuck at
// aborted === false. Node and the browsers abort it in every case below.
describe.concurrent("AbortSignal.timeout() still fires after its observers go away", () => {
  // Resolves after the deadline of a signal armed before this call with a
  // shorter delay: the fence sits behind it in the timer heap, so by the time
  // the fence fires that signal's own timer has had its turn. Waiting on a
  // fence rather than on the signal under test keeps the latter unobserved.
  function fence(ms: number): Promise<void> {
    const signal = AbortSignal.timeout(ms);
    return new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  }

  function summarize(signal: AbortSignal) {
    return { aborted: signal.aborted, reason: signal.reason?.name };
  }

  const churn: [string, (signal: AbortSignal) => void][] = [
    [
      "an abort listener was added and removed",
      signal => {
        const listener = () => {};
        signal.addEventListener("abort", listener);
        signal.removeEventListener("abort", listener);
      },
    ],
    [
      "onabort was set and cleared",
      signal => {
        signal.onabort = () => {};
        signal.onabort = null;
      },
    ],
    [
      "its abort listener was removed through the listener's { signal } option",
      signal => {
        const controller = new AbortController();
        signal.addEventListener("abort", () => {}, { signal: controller.signal });
        controller.abort();
      },
    ],
    [
      // Not even a removal: adding a listener for any other event type updates
      // the listener bookkeeping while the abort listener count is still zero.
      "a listener for an unrelated event type was added",
      signal => {
        signal.addEventListener("unrelated", () => {});
      },
    ],
    [
      // Native consumers observe the signal through a native callback rather
      // than a JS listener; fs.watch() drops its callback synchronously in close().
      "the fs.watch() it was passed to was closed",
      signal => {
        watch(import.meta.dir, { signal }).close();
      },
    ],
  ];

  test.each(churn)("after %s", async (_, apply) => {
    const signal = AbortSignal.timeout(1);
    apply(signal);
    await fence(20);
    expect(summarize(signal)).toEqual({ aborted: true, reason: "TimeoutError" });
  });

  test("consumers attached after the listener churn still see the abort", async () => {
    const signal = AbortSignal.timeout(1);
    const listener = () => {};
    signal.addEventListener("abort", listener);
    signal.removeEventListener("abort", listener);

    const events: string[] = [];
    signal.addEventListener("abort", event => events.push(event.type));
    const dependent = AbortSignal.any([signal]);
    await fence(20);

    let thrown: DOMException | undefined;
    try {
      signal.throwIfAborted();
    } catch (error) {
      thrown = error as DOMException;
    }
    expect({ events, dependent: summarize(dependent), thrown: thrown?.name }).toEqual({
      events: ["abort"],
      dependent: { aborted: true, reason: "TimeoutError" },
      thrown: "TimeoutError",
    });
    expect(thrown).toBe(signal.reason);
  });

  // Same native-callback release as fs.watch() above, but asynchronous: the
  // subprocess lets go of the signal when the child exits.
  test("after the Bun.spawn() child it was passed to has exited", async () => {
    // The child has to be gone before the deadline. A shell exits in ~1ms
    // (a debug build of bun takes 100ms+ just to start), so 500ms leaves
    // plenty of room for a loaded CI machine.
    const signal = AbortSignal.timeout(500);
    const deadline = fence(600);
    await using proc = Bun.spawn({
      cmd: isWindows ? [process.env.comspec || "cmd.exe", "/c", "exit", "0"] : ["/bin/sh", "-c", "exit 0"],
      signal,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect({ exitCode: await proc.exited, ...summarize(signal) }).toEqual({
      exitCode: 0,
      aborted: false,
      reason: undefined,
    });

    await deadline;
    expect(summarize(signal)).toEqual({ aborted: true, reason: "TimeoutError" });
  });

  // A Request keeps its signal as a native ref and wraps it again on demand, so
  // the signal's JS wrapper can be collected while the timeout is still
  // observable through request.signal. The timer has to survive the wrapper as
  // well; only the signal itself going away (or aborting) may stop it.
  // Subprocess so heapStats() only sees this scenario's signals.
  test("after its wrapper was collected while a Request still held the signal", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const wrappers = () => heapStats().objectTypeCounts.AbortSignal ?? 0;
      const N = 32;
      // Nothing has collected yet in a fresh process, and heapStats() collects
      // itself in that case, which would collect the wrappers in the middle of
      // counting them. Collect up front so the two counts below are comparable.
      Bun.gc(true);
      // A full GC of the debug heap takes ~100ms under ASAN; the deadline only
      // has to come after it.
      const deadline = 1000;
      const started = performance.now();
      const requests = [];
      for (let i = 0; i < N; i++) {
        requests.push(new Request("http://localhost/", { signal: AbortSignal.timeout(deadline) }));
      }
      const fence = AbortSignal.timeout(deadline + 100);
      const withWrappers = wrappers();
      // Fresh stack first, so nothing conservatively scanned still points at a wrapper.
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
      const collected = withWrappers - wrappers();
      const collectedBeforeDeadline = performance.now() - started < deadline;
      await new Promise(resolve => fence.addEventListener("abort", resolve, { once: true }));
      // request.signal wraps the native signal again.
      const timedOut = requests.filter(r => r.signal.aborted && r.signal.reason.name === "TimeoutError").length;
      console.log(JSON.stringify({ N, collected, collectedBeforeDeadline, timedOut }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { N, collected, collectedBeforeDeadline, timedOut } = JSON.parse(stdout);
    // The wrappers have to be gone before the timers fire for the run to mean
    // anything; allow a straggler or two in case something still pins one.
    expect(collected).toBeGreaterThanOrEqual(N - 4);
    expect({ collectedBeforeDeadline, timedOut }).toEqual({ collectedBeforeDeadline: true, timedOut: N });
    expect(exitCode).toBe(0);
  });
});
