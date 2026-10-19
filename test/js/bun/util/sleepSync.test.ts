import { sleepSync } from "bun";
import { expect, it, jest } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

it("sleepSync uses milliseconds", async () => {
  const start = performance.now();
  sleepSync(50);
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(5);
  expect(end - start).toBeLessThan(1000);
});

it("sleepSync with no arguments throws", async () => {
  // @ts-expect-error
  expect(() => sleepSync()).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "milliseconds must be a number",
    }),
  );
});

it("sleepSync with non-numbers throws", async () => {
  const valueOf = jest.fn(() => 1);
  const invalidValues = [true, false, "hi", "1", 1n, {}, [], undefined, null, new Number(1), { valueOf }] as any[];
  for (const v of invalidValues) {
    expect(() => sleepSync(v)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: "milliseconds must be a number",
      }),
    );
  }
  expect(valueOf).not.toHaveBeenCalled();
});

it("sleepSync with negative number throws", async () => {
  for (const [v, got] of [
    [-10, -10],
    [-1.5, -1],
    [-Infinity, -2147483648],
  ]) {
    expect(() => sleepSync(v)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `argument to sleepSync must not be negative, got ${got}`,
      }),
    );
  }
});

it("sleepSync takes -0, a fraction above -1 and NaN as 0", async () => {
  for (const v of [-0, -0.9, NaN]) expect(sleepSync(v)).toBeUndefined();
});

it("can map with sleepSync", async () => {
  [1, 2, 3].map(sleepSync);
});

// Free blocks inside pages that are still in use belong to the thread that owns the pages. They go back to the OS
// when that thread tells mimalloc that it is about to block.
it.skipIf(isASAN /* malloc is not mimalloc */)(
  "sleepSync lets mimalloc release this thread's free memory",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const { heapStats } = require("bun:jsc");
      const purgeCalls = () => heapStats().mimalloc.purge_calls;
      const spin = ms => { const start = performance.now(); while (performance.now() - start < ms); };

      // the characters of these strings are allocated and freed by this thread
      let strings = [];
      for (let i = 0; i < 100000; i++) strings.push(Buffer.alloc(900 + (i % 5) * 8, 97).toString("latin1"));
      // (far enough apart that whole OS pages are free in between, also where those are 16 KB)
      strings = strings.filter((_, i) => i % 64 === 0);
      Bun.gc(true);

      // what needs no idle thread settles first, without going idle
      let before = purgeCalls();
      for (let stable = 0, tries = 0; stable < 3 && tries < 50; tries++) {
        spin(60);
        const now = purgeCalls();
        stable = now === before ? stable + 1 : 0;
        before = now;
      }

      let released = 0;
      for (let i = 0; i < 20 && released < 500; i++) {
        Bun.sleepSync(100);
        released = purgeCalls() - before;
      }
      console.log(released >= 500, strings.length);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true 1563\n", stderr: "", exitCode: 0 });
  },
);
