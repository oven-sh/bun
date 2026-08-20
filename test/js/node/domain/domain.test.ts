import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import domain from "node:domain";

describe("domain.bind()", () => {
  test("returns the callback's return value", () => {
    const d = domain.create();
    const bound = d.bind(() => 42);
    expect(bound()).toBe(42);
  });

  test("forwards the caller's this and arguments", () => {
    const d = domain.create();
    const receiver = { tag: "rx" };
    const bound = d.bind(function (this: any, a: number, b: number) {
      return [this, a, b];
    });
    expect(bound.call(receiver, 1, 2)).toEqual([receiver, 1, 2]);
  });

  test("makes the domain active while the callback runs", () => {
    const d = domain.create();
    let inside;
    const bound = d.bind(() => {
      inside = process.domain;
    });
    expect(process.domain == null).toBe(true);
    bound();
    expect(inside).toBe(d);
    expect(process.domain == null).toBe(true);
  });

  test("sets .domain on the returned function", () => {
    const d = domain.create();
    const bound = d.bind(() => {});
    expect((bound as any).domain).toBe(d);
  });
});

describe("domain.intercept()", () => {
  test("returns the callback's return value", () => {
    const d = domain.create();
    const intercepted = d.intercept(() => 99);
    expect(intercepted(null)).toBe(99);
  });

  test("drops the leading (error) argument before invoking the callback", () => {
    const d = domain.create();
    const receiver = { tag: "rx" };
    const intercepted = d.intercept(function (this: any, ...args: unknown[]) {
      return [this, ...args];
    });
    expect(intercepted.call(receiver, null, 1, 2)).toEqual([receiver, 1, 2]);
  });

  test("emits on the domain when the first argument is an Error", () => {
    const d = domain.create();
    let caught: any;
    d.on("error", (e: any) => {
      caught = e;
    });
    const fn = (..._args: unknown[]) => {
      throw new Error("should not run");
    };
    const intercepted = d.intercept(fn);
    const err = new Error("boom");
    expect(intercepted(err, 1, 2)).toBeUndefined();
    expect(caught).toBe(err);
    expect(caught.domain).toBe(d);
    expect(caught.domainBound).toBe(fn);
    expect(caught.domainThrown).toBe(false);
  });

  test("does not treat a truthy non-Error first argument as an error", () => {
    const d = domain.create();
    let caught;
    d.on("error", (e: any) => {
      caught = e;
    });
    const intercepted = d.intercept((...args: unknown[]) => args);
    expect(intercepted("not-an-error", 1, 2)).toEqual([1, 2]);
    expect(caught).toBeUndefined();
  });

  test("makes the domain active while the callback runs", () => {
    const d = domain.create();
    let inside;
    expect(process.domain == null).toBe(true);
    d.intercept(() => {
      inside = process.domain;
    })(null);
    expect(inside).toBe(d);
    expect(process.domain == null).toBe(true);
  });
});

describe("domain.run()", () => {
  test("returns the callback's return value and forwards arguments", () => {
    const d = domain.create();
    expect(
      d.run(function (this: any, a: string) {
        return [this === d, a];
      }, "x"),
    ).toEqual([true, "x"]);
  });
});

// https://github.com/oven-sh/bun/issues/5923
// https://github.com/oven-sh/bun/issues/24287
// gulp's async-done wraps each task via d.bind(task) and inspects the return
// value to decide whether it got a promise/stream/observable back. When bind()
// dropped the return value the promise was never awaited and gulp reported
// "Did you forget to signal async completion?".
test.concurrent("async-done style: d.bind(fn)() surfaces a returned promise", async () => {
  const src = `
    const domain = require("node:domain");

    function asyncDone(fn, cb) {
      const d = domain.create();
      d.once("error", cb);
      const bound = d.bind(fn);
      const result = bound(cb);
      if (result && typeof result.then === "function") {
        result.then(r => cb(null, r), cb);
      }
    }

    asyncDone(
      () => Promise.resolve("task-value"),
      (err, res) => {
        if (err) {
          console.log("ERR", err && err.message);
        } else {
          console.log("DONE", res);
        }
      },
    );
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("DONE task-value");
  expect(exitCode).toBe(0);
});
