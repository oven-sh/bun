// The modules of src/js make their FinalizationRegistry and WeakRef objects with the constructors that the engine
// began with, and call `register`, `unregister` and `deref` through require("internal/weak_references"). So a program
// that replaces the globals or the methods of the prototypes, as a sandbox does while a script runs, changes nothing
// in them. fs.promises.open() is in test/regression/issue/49616.test.ts, Bun.sql in test/js/sql/sql-handles.test.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const replaced = /* js */ `
  const blocked = name => function () { throw new Error(name + " is blocked"); };
  const registry = FinalizationRegistry.prototype, weakRef = WeakRef.prototype;
  globalThis.FinalizationRegistry = blocked("FinalizationRegistry");
  globalThis.WeakRef = blocked("WeakRef");
  registry.register = blocked("register");
  registry.unregister = blocked("unregister");
  weakRef.deref = blocked("deref");
`;

test.concurrent.each([
  [
    "util.aborted()",
    /* js */ `
      const { aborted } = require("node:util");
      const { getEventListeners } = require("node:events");
      (async () => {
        const fired = new AbortController();
        const settled = aborted(fired.signal, {});
        fired.abort();
        await settled;
        // Nothing holds the resource of this call: the registry takes the listener off the signal.
        const quiet = new AbortController();
        (() => void aborted(quiet.signal, {}))();
        while (getEventListeners(quiet.signal, "abort").length > 0) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log("settled, and the listener of a dropped resource is gone");
      })();
    `,
    "settled, and the listener of a dropped resource is gone",
  ],
  [
    "v8.GCProfiler",
    /* js */ `
      const profiler = new (require("node:v8").GCProfiler)();
      profiler.start();
      console.log(Object.keys(profiler.stop()).join());
    `,
    "version,startTime,endTime,statistics",
  ],
  [
    "diagnostics_channel.channel()",
    /* js */ `
      const { channel } = require("node:diagnostics_channel");
      console.log(channel("a") === channel("a"), channel("a") === channel("b"));
    `,
    "true false",
  ],
  [
    // The 65th context looks at which of the first 64 are alive.
    "vm.createContext()",
    /* js */ `
      const vm = require("node:vm");
      console.log(Array.from({ length: 70 }, (_, i) => vm.runInContext("i", vm.createContext({ i }))).at(-1));
    `,
    "69",
  ],
  [
    "process.finalization",
    /* js */ `
      const target = {};
      process.finalization.register(target, (_, event) => console.log("the target is alive at", event));
      process.finalization.unregister({});
    `,
    "the target is alive at exit",
  ],
  [
    "a Worker of node:worker_threads with eval",
    /* js */ `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker("require('node:worker_threads').parentPort.postMessage('from the worker')", { eval: true });
      worker.on("message", console.log);
    `,
    "from the worker",
  ],
])("%s with FinalizationRegistry and WeakRef replaced", async (_, program, expected) => {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", replaced + program],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});
