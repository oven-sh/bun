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

// util.promisify() reads the property at one place for the whole program. Calls on any
// functions warm that read, and then one call for each of two timers is enough.
test.concurrent.each(["setImmediate", "setInterval"])(
  "util.promisify(setTimeout) is the promise form of setTimeout after util.promisify(%s)",
  async first => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const util = require("node:util");
         const timers = require("node:timers");
         const timersPromises = require("node:timers/promises");
         for (let i = 0; i < 300; i++) util.promisify(function (callback) { callback(null, i); });
         const name = fn => Object.keys(timersPromises).find(key => timersPromises[key] === fn);
         const firstName = name(util.promisify(timers[${JSON.stringify(first)}]));
         const sleep = util.promisify(timers.setTimeout);
         // The promise form of setTimeout resolves with its second argument.
         Promise.resolve(sleep(1, "value"))
           .then(value => ({ value: typeof value === "string" ? value : typeof value }), error => ({ error: error.code }))
           .then(result => {
             console.log(JSON.stringify({ first: firstName, sleep: name(sleep), ...result }));
             // The promise form of setInterval starts an interval, which keeps the process alive.
             process.exit(0);
           });`,
      ],
      // Synchronous JIT, as above: the read is warm after a fixed number of calls.
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ first, sleep: "setTimeout", value: "value" });
    expect(exitCode).toBe(0);
  },
);
