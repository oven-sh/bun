import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/44275
// setTimeout, setInterval and setImmediate share one Structure. With a per-function
// CustomGetterSetter for [util.promisify.custom], the warm inline cache returned the
// getter of whichever timer it saw first.
test("util.promisify.custom stays per timer once the property read is warm", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { promisify } = require("node:util");
       const sym = promisify.custom;
       const read = fn => fn[sym].name;
       const timers = [setTimeout, setInterval, setImmediate];
       const cold = timers.map(read);
       for (let i = 0; i < 300; i++) {
         for (const fn of timers) read(fn);
         for (const fn of timers) promisify(fn);
       }
       const warm = timers.map(read);
       const warmPromisify = timers.map(fn => promisify(fn).name);
       const d = Object.getOwnPropertyDescriptor(setTimeout, sym);
       const shape = { get: d.get.name, set: typeof d.set, enumerable: d.enumerable, configurable: d.configurable };
       promisify(setTimeout)(1, "value").then(value => {
         console.log(JSON.stringify({ cold, warm, warmPromisify, shape, value }));
       });`,
    ],
    // Synchronous JIT: the inline cache is generated at a fixed iteration, so the run is deterministic.
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const names = ["setTimeout", "setInterval", "setImmediate"];
  expect(JSON.parse(stdout)).toEqual({
    cold: names,
    warm: names,
    warmPromisify: names,
    shape: { get: "get", set: "undefined", enumerable: true, configurable: false },
    value: "value",
  });
  expect(exitCode).toBe(0);
});
