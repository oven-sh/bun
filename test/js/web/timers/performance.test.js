import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { runInNewContext } from "node:vm";

it("performance.clearResourceTimings()", () => {
  performance.clearResourceTimings();
});

it("performance.setResourceTimingBufferSize()", () => {
  performance.setResourceTimingBufferSize(10);
});

it("performance.onresourcetimingbufferfull", () => {
  performance.onresourcetimingbufferfull = () => {};
  performance.onresourcetimingbufferfull();
});

it("performance.now() should be monotonic", () => {
  const first = performance.now();
  const second = performance.now();
  const third = performance.now();
  const fourth = performance.now();
  const fifth = performance.now();
  const sixth = performance.now();
  expect(first).toBeLessThanOrEqual(second);
  expect(second).toBeLessThanOrEqual(third);
  expect(third).toBeLessThanOrEqual(fourth);
  expect(fourth).toBeLessThanOrEqual(fifth);
  expect(fifth).toBeLessThanOrEqual(sixth);
  if (isWindows) {
    // Timer precision is monotonic on Windows, but it is 100ns of precision
    // making it extremely easy to hit overlapping timer values here.
    Bun.sleepSync(0.001);
  }
  expect(Bun.nanoseconds()).toBeGreaterThan(0);
  expect(Bun.nanoseconds()).toBeGreaterThan(sixth);
  expect(Bun.nanoseconds()).toBeNumber(true);
});

it("performance.timeOrigin + performance.now() should be similar to Date.now()", () => {
  expect(Math.abs(performance.timeOrigin + performance.now() - Date.now()) < 1000).toBe(true);
});

it("performance.now is not a constructor", () => {
  // Constructing performance.now used to crash instead of throwing.
  expect(() => new performance.now()).toThrow(TypeError);
  expect(() => Reflect.construct(performance.now, [])).toThrow(TypeError);
  expect(typeof performance.now()).toBe("number");
});

it("performance.now is an operation of Performance.prototype", () => {
  expect(Object.hasOwn(performance, "now")).toBe(false);
  expect(Object.keys(performance)).toEqual([]);
  expect(Object.getOwnPropertyDescriptor(Performance.prototype, "now")).toEqual({
    value: performance.now,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  expect({ name: Performance.prototype.now.name, length: Performance.prototype.now.length }).toEqual({
    name: "now",
    length: 0,
  });
  expect(Performance.prototype.now.call(performance)).toBeNumber();
});

it("Performance.prototype.now throws for a receiver that is not a Performance", () => {
  const { now } = Performance.prototype;
  const invalidThis = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_THIS",
    message: "Can only call Performance.now on instances of Performance",
  });
  const receivers = [
    undefined,
    null,
    {},
    globalThis,
    Object.create(performance),
    Performance.prototype,
    new EventTarget(),
    1,
    "now",
  ];
  for (const receiver of receivers) {
    expect(() => now.call(receiver)).toThrow(invalidThis);
  }
  expect(() => now()).toThrow(invalidThis);
  expect(() => (0, performance.now)()).toThrow(invalidThis);
});

it("a replacement of Performance.prototype.now is what performance.now() calls", () => {
  const original = Performance.prototype.now;
  try {
    Performance.prototype.now = function () {
      return -1 - original.call(this);
    };
    expect(performance.now()).toBeLessThan(0);
  } finally {
    Performance.prototype.now = original;
  }
  expect(performance.now()).toBeGreaterThan(0);
});

it("an own performance.now hides the method of the prototype until it is deleted", () => {
  const before = Object.getOwnPropertyDescriptor(performance, "now");
  performance.now = () => -1;
  try {
    expect(Object.hasOwn(performance, "now")).toBe(true);
    expect(performance.now()).toBe(-1);
    expect(delete performance.now).toBe(true);
    expect(performance.now).toBe(Performance.prototype.now);
    expect(performance.now()).toBeGreaterThan(0);
  } finally {
    if (before) Object.defineProperty(performance, "now", before);
  }
  expect(before).toBeUndefined();
});

it("a patch of Performance.prototype.now made before performance is first read is what performance.now() calls", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Performance.prototype.now = () => -1; console.log(performance.now(), Object.hasOwn(performance, "now"));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "-1 false\n", stderr: "", exitCode: 0 });
});

it("a detached now() of a performance handed into a node:vm context throws", () => {
  const outcome = runInNewContext(
    `(() => { const { now } = performance; try { return typeof now(); } catch (error) { return error.name + " " + error.code; } })()`,
    { performance },
  );
  expect(outcome).toBe("TypeError ERR_INVALID_THIS");
});

it("performance.now lies on Performance.prototype in a Worker", async () => {
  const source = `
    const { now } = performance;
    let detached;
    try {
      now();
    } catch (error) {
      detached = error.code;
    }
    postMessage([Object.hasOwn(performance, "now"), typeof Performance.prototype.now, Object.keys(performance), detached]);
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  const worker = new Worker(url);
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    worker.onmessage = event => resolve(event.data);
    worker.onerror = reject;
    expect(await promise).toEqual([false, "function", [], "ERR_INVALID_THIS"]);
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});

// https://github.com/oven-sh/bun/issues/5604
it("performance.now() DOMJIT", () => {
  // This test is very finnicky.
  // It has to return true || return false to reproduce. Throwing an error doesn't work.
  function run(start, prev) {
    while (true) {
      const current = performance.now();

      if (Number.isNaN(current) || current < prev) {
        return false;
      }

      if (current - start > 200) {
        return true;
      }
      prev = current;
    }
  }

  const start = performance.now();
  if (!run(start, start)) {
    throw new Error("performance.now() is not monotonic");
  }
});

it("Performance.prototype.now checks its receiver after the call is optimized", () => {
  const { now } = Performance.prototype;
  function read(receiver) {
    return now.call(receiver);
  }
  let last = 0;
  for (let i = 0; i < 200_000; i++) last = read(performance);
  expect(last).toBeGreaterThan(0);
  for (const receiver of [{}, Object.create(performance), undefined]) {
    expect(() => read(receiver)).toThrow(expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_THIS" }));
  }
  expect(read(performance)).toBeGreaterThanOrEqual(last);
});
