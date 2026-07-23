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

// https://dom.spec.whatwg.org/#interface-abortcontroller
describe("AbortController (DOM spec)", () => {
  test("signal is the same object on every access", () => {
    const controller = new AbortController();
    expect(controller.signal).toBe(controller.signal);
  });

  test("AbortSignal is not constructible", () => {
    expect(() => new (AbortSignal as any)()).toThrow(TypeError);
  });

  test("a fresh signal is not aborted and has no reason", () => {
    const { signal } = new AbortController();
    expect(signal.aborted).toBe(false);
    expect(signal.reason).toBeUndefined();
  });

  test("abort(reason) stores the reason by identity", () => {
    const controller = new AbortController();
    const reason = { why: "because" };
    controller.abort(reason);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);
  });

  test("abort(reason) accepts falsy reasons", () => {
    const controller = new AbortController();
    controller.abort(0);
    expect(controller.signal.reason).toBe(0);
  });

  test("abort() without a reason creates an AbortError DOMException", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
    expect(controller.signal.reason.name).toBe("AbortError");
  });

  test("abort(undefined) behaves like abort()", () => {
    const controller = new AbortController();
    controller.abort(undefined);
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
    expect(controller.signal.reason.name).toBe("AbortError");
  });

  test("a second abort() keeps the first reason and does not fire again", () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    controller.signal.addEventListener("abort", () => calls.push(controller.signal.reason));
    controller.abort("first");
    controller.abort("second");
    expect(controller.signal.reason).toBe("first");
    expect(calls).toEqual(["first"]);
  });

  test("the abort event is a plain Event targeted at the signal", () => {
    const controller = new AbortController();
    const events: Event[] = [];
    controller.signal.addEventListener("abort", event => events.push(event));
    controller.abort();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("abort");
    expect(events[0].target).toBe(controller.signal);
    expect(events[0].bubbles).toBe(false);
    expect(events[0].cancelable).toBe(false);
  });

  test("listeners added after the abort never fire", () => {
    const signal = AbortSignal.abort();
    let fired = false;
    signal.addEventListener("abort", () => (fired = true));
    expect(fired).toBe(false);
  });

  test("aborting inside an abort listener does not re-dispatch", () => {
    const controller = new AbortController();
    let calls = 0;
    controller.signal.addEventListener("abort", () => {
      calls++;
      controller.abort();
    });
    controller.abort();
    expect(calls).toBe(1);
  });

  test("a listener added during dispatch is not called for that dispatch", () => {
    const controller = new AbortController();
    let lateCalls = 0;
    controller.signal.addEventListener("abort", () => {
      controller.signal.addEventListener("abort", () => lateCalls++);
    });
    controller.abort();
    expect(lateCalls).toBe(0);
  });

  test("onabort runs in registration order among listeners", () => {
    const controller = new AbortController();
    const order: string[] = [];
    controller.signal.addEventListener("abort", () => order.push("first"));
    controller.signal.onabort = () => order.push("onabort");
    controller.signal.addEventListener("abort", () => order.push("last"));
    controller.abort();
    expect(order).toEqual(["first", "onabort", "last"]);
  });

  test("onabort receives the signal as this and the event as its argument", () => {
    const controller = new AbortController();
    let seenThis: unknown;
    let seenType: unknown;
    controller.signal.onabort = function (event) {
      seenThis = this;
      seenType = event.type;
    };
    controller.abort();
    expect(seenThis).toBe(controller.signal);
    expect(seenType).toBe("abort");
  });

  test("the aborted getter rejects foreign receivers", () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!;
    expect(() => descriptor.get!.call({})).toThrow(TypeError);
  });
});

describe("AbortSignal.prototype.throwIfAborted", () => {
  test("returns undefined when the signal is not aborted", () => {
    expect(new AbortController().signal.throwIfAborted()).toBeUndefined();
  });

  test("throws the reason by identity", () => {
    const controller = new AbortController();
    const reason = new Error("nope");
    controller.abort(reason);
    let thrown: unknown = "not thrown";
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(reason);
  });

  test("throws the default DOMException", () => {
    const signal = AbortSignal.abort();
    try {
      signal.throwIfAborted();
      expect.unreachable();
    } catch (error: any) {
      expect(error).toBe(signal.reason);
      expect(error.name).toBe("AbortError");
    }
  });

  test("throws a falsy reason", () => {
    const controller = new AbortController();
    controller.abort(0);
    let thrown: unknown = "not thrown";
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(0);
  });
});

describe("AbortSignal.abort", () => {
  test("returns an already-aborted signal", () => {
    const signal = AbortSignal.abort();
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
  });

  test("stores the reason by identity", () => {
    const reason = { why: 1 };
    expect(AbortSignal.abort(reason).reason).toBe(reason);
  });
});

// Every engine that ships DOMException attaches a stack to it, and abort reasons
// are useless to debug without one.
describe("the stack of a DOMException abort reason", () => {
  // https://github.com/oven-sh/bun/issues/17877
  test.failing("a constructed DOMException has a stack", () => {
    expect(typeof new DOMException("boom", "AbortError").stack).toBe("string");
  });

  // https://github.com/oven-sh/bun/issues/17877
  test.failing("AbortSignal.abort() produces a reason with a stack", () => {
    expect(typeof AbortSignal.abort().reason.stack).toBe("string");
  });

  test.failing("controller.abort() produces a stack naming the error", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.reason.stack).toContain("AbortError");
  });

  // https://github.com/oven-sh/bun/issues/25182, https://github.com/oven-sh/bun/issues/21900
  test.failing("AbortSignal.timeout() produces a reason with a non-empty stack", async () => {
    const signal = AbortSignal.timeout(1);
    expect(await waitUntilAborted(signal)).toBe(true);
    expect(signal.reason.stack).not.toBe("");
    expect(typeof signal.reason.stack).toBe("string");
  });
});

// Awaiting the abort event of a timeout signal wedges the test runner on Windows:
// https://github.com/oven-sh/bun/issues/33334. Polling the flag with a bound fails
// loudly instead of hanging the whole file. Revert to awaiting the event once fixed.
async function waitUntilAborted(signal: AbortSignal) {
  for (let attempt = 0; attempt < 2000 && !signal.aborted; attempt++) {
    await Bun.sleep(1);
  }
  return signal.aborted;
}

describe("AbortSignal.timeout", () => {
  test("eventually aborts with a TimeoutError", async () => {
    const signal = AbortSignal.timeout(1);
    expect(await waitUntilAborted(signal)).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe("TimeoutError");
  });

  test("rejects delays that are not unsigned long long", () => {
    expect(() => AbortSignal.timeout(-1)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(NaN)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(Infinity)).toThrow(TypeError);
  });
});

describe("AbortSignal.any", () => {
  test("is already aborted when a source signal is", () => {
    const reason = { why: 1 };
    const signal = AbortSignal.any([AbortSignal.abort(reason)]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("takes the reason of the first already-aborted source", () => {
    const signal = AbortSignal.any([AbortSignal.abort("a"), AbortSignal.abort("b")]);
    expect(signal.reason).toBe("a");
  });

  test("propagates a later abort by identity", () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal]);
    const reason = { why: 2 };
    controller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("fires once even when several sources abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = AbortSignal.any([a.signal, b.signal]);
    let calls = 0;
    signal.addEventListener("abort", () => calls++);
    a.abort();
    b.abort();
    expect(calls).toBe(1);
    expect(signal.reason).toBe(a.signal.reason);
  });

  test("never aborts when given no signals", () => {
    const signal = AbortSignal.any([]);
    expect(signal.aborted).toBe(false);
    expect(signal.reason).toBeUndefined();
  });

  test("follows a composite signal", () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([AbortSignal.any([controller.signal])]);
    controller.abort("deep");
    expect(signal.reason).toBe("deep");
  });

  test("accepts any iterable of signals", () => {
    const controller = new AbortController();
    const signal = AbortSignal.any(new Set([controller.signal]));
    controller.abort("set");
    expect(signal.reason).toBe("set");
  });

  test("rejects a non-iterable argument", () => {
    expect(() => (AbortSignal as any).any(1)).toThrow(TypeError);
  });

  test("rejects an iterable of non-signals", () => {
    expect(() => (AbortSignal as any).any([1])).toThrow(TypeError);
  });
});
