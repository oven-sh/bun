import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";

test("we can go back in time", () => {
  const DateBeforeMocked = Date;
  const orig = new Date();
  orig.setHours(0, 0, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date("1995-12-19T00:00:00.000Z"));

  expect(new Date().toISOString()).toBe("1995-12-19T00:00:00.000Z");
  expect(Date.now()).toBe(819331200000);

  if (typeof Bun !== "undefined") {
    // In bun, the Date object remains the same despite being mocked.
    // This prevents a whole bunch of subtle bugs in tests.
    expect(DateBeforeMocked).toBe(Date);
    expect(DateBeforeMocked.now).toBe(Date.now);

    // Jest doesn't property mock new Intl.DateTimeFormat().format()
    expect(new Intl.DateTimeFormat().format()).toBe("12/19/1995");
  } else {
    expect(DateBeforeMocked).not.toBe(Date);
    expect(DateBeforeMocked.now).not.toBe(Date.now);
  }
  jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z").getTime());
  expect(new Date().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(Date.now()).toBe(1577836800000);
  jest.useRealTimers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expect(now.toISOString()).toBe(orig.toISOString());
});

test("advanceTimersByTime ticks from the setSystemTime value", () => {
  jest.useFakeTimers();
  try {
    const base = new Date("2026-01-01T12:00:00.000Z").getTime();
    jest.setSystemTime(new Date(base));
    expect(Date.now()).toBe(base);

    jest.advanceTimersByTime(1000);
    expect(Date.now()).toBe(base + 1000);
    expect(new Date().toISOString()).toBe("2026-01-01T12:00:01.000Z");

    jest.advanceTimersByTime(500);
    expect(Date.now()).toBe(base + 1500);

    // setSystemTime with a number argument rebases again
    jest.setSystemTime(base);
    jest.advanceTimersByTime(2000);
    expect(Date.now()).toBe(base + 2000);
  } finally {
    jest.useRealTimers();
  }
});

test("setSystemTime accepts pre-epoch and epoch times and resets with no argument", () => {
  const realBefore = Date.now();
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date("1960-01-01T00:00:00.000Z"));
    expect(Date.now()).toBe(-315619200000);
    expect(new Date().toISOString()).toBe("1960-01-01T00:00:00.000Z");

    jest.setSystemTime(0);
    expect(Date.now()).toBe(0);

    // -1 is an ordinary timestamp (1969-12-31T23:59:59.999Z), not a sentinel.
    jest.setSystemTime(-1);
    expect(Date.now()).toBe(-1);

    jest.setSystemTime();
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["'x'", "Symbol()", "1n"])("useFakeTimers does not crash when globalThis.setTimeout is %s", async value => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.setTimeout = ${value};
         const jest = Bun.jest().jest;
         jest.useFakeTimers();
         jest.useRealTimers();
         console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  expect(proc.signalCode).toBeNull();
});

// useFakeTimers() marks the value of globalThis.setTimeout with an own `clock` property. User code can put any object there.
describe("the clock marker of useFakeTimers() on a setTimeout of the user", () => {
  const data = { value: true, writable: true, enumerable: true, configurable: true };

  // Calls `run` while `globalThis.setTimeout` is the property that `replacement` describes.
  function withSetTimeout(replacement: PropertyDescriptor, run: () => void) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
    Object.defineProperty(globalThis, "setTimeout", { ...replacement, configurable: true });
    try {
      run();
    } finally {
      Object.defineProperty(globalThis, "setTimeout", original);
      jest.useRealTimers();
    }
  }

  function thrownBy(fn: () => unknown) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return "did not throw";
  }

  // A bound function is what happy-dom's GlobalRegistrator puts in globalThis.setTimeout.
  test.each([
    ["a function", () => function () {}],
    ["a bound function", () => setTimeout.bind(globalThis)],
  ])("%s gets the marker and useRealTimers() removes it", (_, make) => {
    const fn = make();
    withSetTimeout({ value: fn }, () => {
      expect<unknown>(jest.useFakeTimers()).toBe(jest);
      expect(Object.getOwnPropertyDescriptor(fn, "clock")).toEqual(data);
      expect<unknown>(jest.useRealTimers()).toBe(jest);
      expect(Object.hasOwn(fn, "clock")).toBe(false);
    });
  });

  test.each([
    ["frozen", Object.freeze],
    ["sealed", Object.seal],
    ["non-extensible", Object.preventExtensions],
  ])("a %s function is not changed and fake timers are on", (_, lock) => {
    const fn = lock(function () {});
    const keys = Reflect.ownKeys(fn);
    withSetTimeout({ value: fn }, () => {
      expect<unknown>(jest.useFakeTimers()).toBe(jest);
      expect(jest.isFakeTimers()).toBe(true);
      expect(Reflect.ownKeys(fn)).toEqual(keys);
      expect(Object.isExtensible(fn)).toBe(false);
      expect<unknown>(jest.useRealTimers()).toBe(jest);
      expect(jest.isFakeTimers()).toBe(false);
    });
  });

  test.each([
    ["a read-only clock", { value: "of the user", writable: false, enumerable: false, configurable: false }],
    ["an accessor clock", { get: () => "of the user", set: undefined, enumerable: false, configurable: false }],
  ])("%s that is not configurable stays", (_, descriptor) => {
    const fn = Object.defineProperty(function () {}, "clock", descriptor);
    withSetTimeout({ value: fn }, () => {
      expect<unknown>(jest.useFakeTimers()).toBe(jest);
      expect(jest.isFakeTimers()).toBe(true);
      expect(Object.getOwnPropertyDescriptor(fn, "clock")).toEqual(descriptor);
      expect<unknown>(jest.useRealTimers()).toBe(jest);
      expect(Object.getOwnPropertyDescriptor(fn, "clock")).toEqual(descriptor);
    });
  });

  test("a Proxy gets the defineProperty trap", () => {
    const calls: unknown[] = [];
    const target = function () {};
    const proxy = new Proxy(target, {
      defineProperty(target, key, descriptor) {
        calls.push([key, descriptor]);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
    withSetTimeout({ value: proxy }, () => {
      expect<unknown>(jest.useFakeTimers()).toBe(jest);
      expect(calls).toEqual([["clock", data]]);
      expect(Object.prototype.hasOwnProperty.call(proxy, "clock")).toBe(true);
      expect<unknown>(jest.useRealTimers()).toBe(jest);
      expect(Object.hasOwn(target, "clock")).toBe(false);
    });
  });

  test("a defineProperty trap that returns false is not an error", () => {
    const target = function () {};
    const proxy = new Proxy(target, { defineProperty: () => false });
    withSetTimeout({ value: proxy }, () => {
      expect<unknown>(jest.useFakeTimers()).toBe(jest);
      expect(jest.isFakeTimers()).toBe(true);
      expect(Object.hasOwn(target, "clock")).toBe(false);
    });
  });

  test.each([
    [
      "a defineProperty trap that throws",
      () => ({
        value: new Proxy(function () {}, {
          defineProperty() {
            throw new RangeError("from user code");
          },
        }),
      }),
      { name: "RangeError", message: "from user code" },
    ],
    [
      "a revoked Proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable(function () {}, {});
        revoke();
        return { value: proxy };
      },
      {
        name: "TypeError",
        message: "Proxy has already been revoked. No more operations are allowed to be performed on it",
      },
    ],
    [
      "a getter of globalThis.setTimeout that throws",
      () => ({
        get() {
          throw new RangeError("from user code");
        },
      }),
      { name: "RangeError", message: "from user code" },
    ],
  ])("%s makes useFakeTimers() throw and leaves fake timers off", (_, replacement, expected) => {
    withSetTimeout(replacement(), () => {
      const error = thrownBy(() => jest.useFakeTimers()) as Error;
      expect({ name: error.name, message: error.message }).toEqual(expected);
      expect(jest.isFakeTimers()).toBe(false);
    });
  });

  // The store into a WebAssembly GC reference was an abort, so it runs in a process of its own.
  test("a WebAssembly GC reference gets no marker and fake timers are on", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `// (module (type $s (struct (field (mut i32)))) (func (export "mk") (result (ref null $s)) struct.new_default $s))
         const bytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, 1,10,2, 0x5f,1,0x7f,1, 0x60,0,1,0x63,0, 3,2,1,1, 7,6,1,2,0x6d,0x6b,0,0, 10,7,1,5,0,0xfb,1,0,0x0b]);
         globalThis.setTimeout = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
         const jest = Bun.jest().jest;
         console.log(jest.useFakeTimers() === jest, jest.isFakeTimers(), Reflect.ownKeys(globalThis.setTimeout));
         // The reference refuses the [[Delete]] of the marker with a TypeError. The fake clock is off before that.
         try {
           jest.useRealTimers();
           console.log("did not throw");
         } catch (e) {
           console.log(e.name + ": " + e.message, jest.isFakeTimers());
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "true true []\nTypeError: Cannot delete property for WebAssembly GC object false\n",
      stderr: "",
      exitCode: 0,
    });
    expect(proc.signalCode).toBeNull();
  });
});

test("real timer heap is ticked against the real clock under useFakeTimers", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "test-timers-gc-spin-fixture.ts")],
    env: { ...bunEnv, BUN_GC_TIMER_DISABLE: undefined, BUN_GC_TIMER_INTERVAL: undefined },
    stdout: "pipe",
    stderr: "pipe",
    // Pre-fix the child spins at 100% CPU; bound it so it doesn't outlive the
    // runner by long when the parent test times out on the unfixed build.
    timeout: 20_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(stderr);
  expect(stdout).toContain("DRAIN_OK");
  // null => exited on its own; non-null => killed by the spawn timeout (spun).
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

describe.each([
  ["net", () => net.createServer()],
  ["http", () => http.createServer()],
])("%s.Server#listen() while fake timers are active", (_, createServer) => {
  test("emits 'listening' without fake time being advanced", async () => {
    jest.useFakeTimers();
    try {
      const server = createServer();
      try {
        const listening = once(server, "listening");
        server.listen(0, "127.0.0.1");
        // The deferred emit must not be a timer, or it would sit in the fake heap.
        expect(jest.getTimerCount()).toBe(0);
        await listening;
        expect(server.listening).toBe(true);
        expect(server.address()).toMatchObject({ address: "127.0.0.1", port: expect.any(Number) });
      } finally {
        server.close();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  test("emits 'error' for a port that is in use without fake time being advanced", async () => {
    const holder = createServer();
    try {
      holder.listen(0, "127.0.0.1");
      await once(holder, "listening");
      const { port } = holder.address() as net.AddressInfo;

      jest.useFakeTimers();
      try {
        const server = createServer();
        const errored = once(server, "error");
        server.listen(port, "127.0.0.1");
        expect(jest.getTimerCount()).toBe(0);
        const [err] = await errored;
        expect(err).toMatchObject({ code: "EADDRINUSE" });
        expect(server.listening).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    } finally {
      holder.close();
    }
  });
});
