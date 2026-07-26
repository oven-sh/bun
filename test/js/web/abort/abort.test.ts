import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
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
      if (key === "column" || key === "line" || key === "sourceURL") continue;
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

  // DOM spec, AbortSignal GC: a non-aborted signal with a live source (armed timeout, or a
  // dependent any()'s source) must not be collected while "its abort algorithms is non-empty".
  // pipeTo({signal}) and addEventListener(_, _, {signal}) register an abort algorithm without
  // adding an 'abort' event listener, so the wrapper was previously collected early: pipeTo's
  // JSAbortAlgorithm weak callback got nulled (pipe hangs), and an any() composite fell out of
  // its source's weak dependent set (listener leaks). Subprocess so Bun.gc(true) is deterministic.
  describe("an inline signal with a registered abort algorithm survives GC until abort", () => {
    const fixture = `
      const sl = ms => new Promise(r => setTimeout(r, ms));
      const collected = new Set();
      const fr = new FinalizationRegistry(t => collected.add(t));
      const stalled = () => new ReadableStream({ pull() { return new Promise(() => {}); } });
      const race = (p, ms) => {
        let t;
        const ceiling = new Promise(r => { t = setTimeout(() => r("PENDING"), ms); });
        return Promise.race([p.then(() => "resolved", e => "rejected:" + e?.name), ceiling]).finally(() => clearTimeout(t));
      };
      const pump = async ms => {
        const end = performance.now() + ms;
        do { Bun.gc(true); await sl(10); } while (performance.now() < end);
      };
      process.exitCode = 1;
    `;
    test.concurrent("pipeTo({signal: AbortSignal.timeout()})", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          fixture +
            `
          let p;
          (() => {
            const s = AbortSignal.timeout(200);
            fr.register(s, "a");
            p = stalled().pipeTo(new WritableStream({}), { signal: s });
          })();
          await pump(100);
          const beforeDeadline = collected.has("a");
          const outcome = await race(p, 2000);
          await pump(100);
          console.log(JSON.stringify({ outcome, beforeDeadline, afterAbort: collected.has("a") }));
          process.exitCode = 0;
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, result: JSON.parse(stdout.trim() || '""') }).toEqual({
        stderr: "",
        result: { outcome: "rejected:TimeoutError", beforeDeadline: false, afterAbort: true },
      });
      expect(exitCode).toBe(0);
    });
    test.concurrent("pipeTo({signal: AbortSignal.any([timeout()])})", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          fixture +
            `
          let p;
          (() => {
            const s = AbortSignal.any([AbortSignal.timeout(200)]);
            fr.register(s, "e");
            p = stalled().pipeTo(new WritableStream({}), { signal: s });
          })();
          await pump(100);
          const beforeDeadline = collected.has("e");
          const outcome = await race(p, 2000);
          await pump(100);
          console.log(JSON.stringify({ outcome, beforeDeadline, afterAbort: collected.has("e") }));
          process.exitCode = 0;
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, result: JSON.parse(stdout.trim() || '""') }).toEqual({
        stderr: "",
        result: { outcome: "rejected:TimeoutError", beforeDeadline: false, afterAbort: true },
      });
      expect(exitCode).toBe(0);
    });
    test.concurrent("addEventListener(_, _, {signal: AbortSignal.any([timeout()])})", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          fixture +
            `
          const et = new EventTarget();
          let n = 0;
          (() => {
            const s = AbortSignal.any([AbortSignal.timeout(200)]);
            fr.register(s, "c");
            et.addEventListener("x", () => n++, { signal: s });
          })();
          await pump(100);
          const beforeDeadline = collected.has("c");
          await pump(300);
          et.dispatchEvent(new Event("x"));
          console.log(JSON.stringify({ fired: n, beforeDeadline, afterAbort: collected.has("c") }));
          process.exitCode = 0;
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, result: JSON.parse(stdout.trim() || '""') }).toEqual({
        stderr: "",
        result: { fired: 0, beforeDeadline: false, afterAbort: true },
      });
      expect(exitCode).toBe(0);
    });
    // Release path: once the pipe-op finalizes and removes its algorithm, nothing pins the wrapper.
    test.concurrent("wrapper is collectable once the pipe completes and removes its algorithm", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          fixture +
            `
          let p;
          (() => {
            const s = AbortSignal.timeout(60_000);
            fr.register(s, "r");
            p = new ReadableStream({ start(c) { c.close(); } }).pipeTo(new WritableStream({}), { signal: s });
          })();
          await p;
          await pump(200);
          console.log(JSON.stringify({ afterFinalize: collected.has("r") }));
          process.exitCode = 0;
        `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, result: JSON.parse(stdout.trim() || '""') }).toEqual({
        stderr: "",
        result: { afterFinalize: true },
      });
      expect(exitCode).toBe(0);
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
