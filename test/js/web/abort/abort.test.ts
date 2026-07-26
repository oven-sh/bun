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

  // A signal's abort algorithms (pipeTo's abort handler, addEventListener({signal})'s
  // listener-removal callback) must count as abort observers for the wrapper's GC
  // reachability check. Previously HasAbortEventListener only reflected JS "abort"
  // listeners and native callbacks, so a timeout/any() signal passed inline with no
  // other JS reference was collected before it could abort.
  describe("abort algorithms keep the signal reachable across GC", () => {
    const stalled = () => new ReadableStream({ pull: () => new Promise(() => {}) });
    const settle = (p: Promise<unknown>) =>
      p.then(
        () => "resolved",
        e => `rejected:${e?.name ?? e}`,
      );
    // Yield before the forced GC so nothing from the synchronous setup frame is
    // still conservatively rooted on the stack.
    async function forceGC() {
      await Bun.sleep(0);
      Bun.gc(true);
      await Bun.sleep(0);
      Bun.gc(true);
    }

    test("pipeTo({signal: AbortSignal.timeout(n)}) aborts after GC", async () => {
      const p = settle(stalled().pipeTo(new WritableStream({}), { signal: AbortSignal.timeout(100) }));
      await forceGC();
      expect(await Promise.race([p, Bun.sleep(2000).then(() => "STILL-PENDING")])).toBe("rejected:TimeoutError");
    });

    test("pipeTo({signal: AbortSignal.any([c.signal])}) aborts after GC", async () => {
      const c = new AbortController();
      const p = settle(stalled().pipeTo(new WritableStream({}), { signal: AbortSignal.any([c.signal]) }));
      await forceGC();
      c.abort(new Error("go"));
      expect(await Promise.race([p, Bun.sleep(2000).then(() => "STILL-PENDING")])).toBe("rejected:Error");
    });

    test("pipeTo({signal: AbortSignal.any([AbortSignal.timeout(n)])}) aborts after GC", async () => {
      const p = settle(
        stalled().pipeTo(new WritableStream({}), { signal: AbortSignal.any([AbortSignal.timeout(100)]) }),
      );
      await forceGC();
      expect(await Promise.race([p, Bun.sleep(2000).then(() => "STILL-PENDING")])).toBe("rejected:TimeoutError");
    });

    test("addEventListener({signal: AbortSignal.any([c.signal])}) removes listener after GC", async () => {
      const et = new EventTarget();
      let calls = 0;
      const c = new AbortController();
      et.addEventListener("x", () => calls++, { signal: AbortSignal.any([c.signal]) });
      await forceGC();
      c.abort();
      et.dispatchEvent(new Event("x"));
      expect(calls).toBe(0);
    });

    // Registering/removing an abort algorithm must not disarm a user-held timeout signal.
    test("timeout still fires after a pipeTo using it completes early", async () => {
      const s = AbortSignal.timeout(50);
      await new ReadableStream({ start: c => c.close() }).pipeTo(new WritableStream({}), { signal: s });
      const result = await Promise.race([
        new Promise(r => s.addEventListener("abort", () => r("aborted"), { once: true })),
        Bun.sleep(2000).then(() => "timeout-never-fired"),
      ]);
      expect({ result, aborted: s.aborted }).toEqual({ result: "aborted", aborted: true });
    });

    test("timeout still fires after addEventListener({signal})+removeEventListener", async () => {
      const s = AbortSignal.timeout(50);
      const et = new EventTarget();
      const fn = () => {};
      et.addEventListener("x", fn, { signal: s });
      et.removeEventListener("x", fn);
      const result = await Promise.race([
        new Promise(r => s.addEventListener("abort", () => r("aborted"), { once: true })),
        Bun.sleep(2000).then(() => "timeout-never-fired"),
      ]);
      expect({ result, aborted: s.aborted }).toEqual({ result: "aborted", aborted: true });
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
