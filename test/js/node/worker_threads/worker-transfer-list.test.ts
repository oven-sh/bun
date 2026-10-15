import { structuredCloneAdvanced } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";
import { Worker } from "worker_threads";
import { echoAnswer, echoEntry, owned, transferable } from "./worker-transfer-list-fixture.ts";

// The transferList option is converted as a whole before workerData is serialized,
// so an entry that is not an object throws instead of being silently skipped while
// the remaining entries get detached.
test("an invalid transferList entry throws before anything is detached", async () => {
  const buf = new ArrayBuffer(8);
  let worker: Worker | undefined;
  try {
    expect(() => {
      worker = new Worker("", { eval: true, workerData: buf, transferList: [buf, null as any] });
    }).toThrow(TypeError);
    expect(buf.byteLength).toBe(8);
  } finally {
    await worker?.terminate();
  }
});

test("a valid transferList still detaches the transferred buffer", async () => {
  const buf = new ArrayBuffer(8);
  const worker = new Worker("", { eval: true, workerData: buf, transferList: [buf] });
  try {
    expect(buf.byteLength).toBe(0);
  } finally {
    await worker.terminate();
  }
});

// A `new Worker()` that throws leaves the transfer list with the caller. The rows that Node has
// too are in worker-transfer-list-node.test.ts.

type WorkerConstructor<W = { terminate(): unknown }> = new (filename: string, options?: any) => W;
// It takes workerData, transferList and execArgv as well; its declared options leave them out.
const GlobalWorker: WorkerConstructor<globalThis.Worker> = globalThis.Worker;
const execArgvOfTheProcess = { execArgv: ["--disallow-code-generation-from-strings"] };
const invalidExecArgv = expect.objectContaining({ code: "ERR_WORKER_INVALID_EXEC_ARGV" });
// The message of the error names it.
const invalidFileURL = "file://:!:!:!!!!";
// Not a file: a constructor that throws does not load its entry.
const neverLoaded = join(import.meta.dir, "never-loaded.js");

describe.each<[string, WorkerConstructor]>([
  ["node:worker_threads", Worker],
  ["the global Worker", GlobalWorker],
])("%s: a rejected preload leaves the transfer list with the caller", (_, WorkerCtor) => {
  test("a preload that is not a valid file URL", () => {
    const { options, stillOwned } = transferable();
    expect(() => new WorkerCtor(neverLoaded, { ...options(), preload: [invalidFileURL] })).toThrow(invalidFileURL);
    expect(stillOwned()).toEqual(owned);
  });

  test("a preload that is a revoked blob: URL", () => {
    const { options, stillOwned } = transferable();
    const url = URL.createObjectURL(new Blob([""]));
    URL.revokeObjectURL(url);
    expect(() => new WorkerCtor(neverLoaded, { ...options(), preload: [url] })).toThrow("Blob URL is missing");
    expect(stillOwned()).toEqual(owned);
  });
});

describe("the global Worker: a rejected option leaves the transfer list with the caller", () => {
  test("an entry that is not a valid file URL", () => {
    const { options, stillOwned } = transferable();
    expect(() => new GlobalWorker(invalidFileURL, options())).toThrow(invalidFileURL);
    expect(stillOwned()).toEqual(owned);
  });

  test("an execArgv flag that only the process takes, and the same list then starts a worker", async () => {
    using dir = tempDir("worker-transfer-list", { "entry.js": echoEntry });
    const entry = join(String(dir), "entry.js");
    const { buf, port1, options, stillOwned } = transferable();
    expect(() => new GlobalWorker(entry, { ...options(), ...execArgvOfTheProcess })).toThrow(invalidExecArgv);
    expect(stillOwned()).toEqual(owned);

    const worker = new GlobalWorker(entry, options());
    try {
      const answer = await new Promise((resolve, reject) => {
        port1.once("message", resolve);
        worker.addEventListener("error", event => reject(new Error(event.message)));
        worker.addEventListener("close", () => reject(new Error("the worker closed before it answered")));
      });
      expect({ answer, bytes: buf.byteLength }).toEqual({ answer: echoAnswer, bytes: 0 });
    } finally {
      worker.terminate();
      port1.close();
    }
  });

  test("an execArgv flag is reported before workerData is read", () => {
    let reads = 0;
    const workerData = {
      get uncloneable() {
        reads++;
        return () => {};
      },
    };
    expect(() => new GlobalWorker(neverLoaded, { workerData, ...execArgvOfTheProcess })).toThrow(invalidExecArgv);
    expect(reads).toBe(0);
  });

  test("a new.target whose prototype getter throws", () => {
    const { options, stillOwned } = transferable();
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        throw new Error("prototype getter");
      },
    });
    expect(() => Reflect.construct(GlobalWorker, [neverLoaded, options()], newTarget)).toThrow("prototype getter");
    expect(stillOwned()).toEqual(owned);
  });
});

// dispose() stops the graph's context in a task of the host's loop, and `expect().resolves` runs that
// loop in place. So the context of the Worker stops between its creation and its start.
test("a context stopped while workerData is serialized: the Worker starts nothing", () => {
  const graph = new Bun.ModuleGraph();
  const hostTurn = new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const worker = graph.run(
    () =>
      new GlobalWorker(neverLoaded, {
        workerData: {
          get stop() {
            graph.dispose();
            expect(hostTurn).resolves.toBeUndefined();
            stopped = true;
            return 1;
          },
        },
      }),
  );
  expect({ stopped, threadId: worker.threadId }).toEqual({ stopped: true, threadId: -1 });
});

// The constructor reads process.env in this step when `env: SHARE_ENV` starts the first such worker of a thread.
describe("SerializedScriptValue::create runs beforeTransfer", () => {
  const clone = (value: unknown, transferList: object[], beforeTransfer: () => void) =>
    structuredCloneAdvanced(value, transferList, false, false, "worker", beforeTransfer);

  test("once, after the getters of the value and before the transfer list is detached", () => {
    const buf = new ArrayBuffer(8);
    const order: string[] = [];
    const value = {
      buf,
      get getter() {
        order.push("getter");
        return true;
      },
    };
    const cloned = clone(value, [buf], () => void order.push(`beforeTransfer, ${buf.byteLength} bytes`));
    expect({ order, bytes: buf.byteLength, clonedBytes: cloned.buf.byteLength }).toEqual({
      order: ["getter", "beforeTransfer, 8 bytes"],
      bytes: 0,
      clonedBytes: 8,
    });
  });

  test("a throw leaves the transfer list with the caller", () => {
    const { buf, port1, port2, stillOwned } = transferable();
    expect(() =>
      clone({ buf, port2 }, [buf, port2], () => {
        throw new RangeError("beforeTransfer");
      }),
    ).toThrow(new RangeError("beforeTransfer"));
    expect(stillOwned()).toEqual(owned);
    port1.close();
  });

  test("a buffer that it detaches fails the clone", () => {
    const buf = new ArrayBuffer(8);
    expect(() => clone(buf, [buf], () => void structuredClone(buf, { transfer: [buf] }))).toThrow(
      "ArrayBuffer in transfer list was detached during serialization",
    );
  });

  test("not for an empty transfer list", () => {
    let calls = 0;
    clone({ a: 1 }, [], () => void calls++);
    expect(calls).toBe(0);
  });
});

async function run(script: string, entry = neverLoaded, env = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script, entry],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// The thread that founds the env tree is a worker in these two, so they need no process of their own.
describe("env: SHARE_ENV in a worker that has an env of its own", () => {
  async function inAWorker(script: string) {
    const worker = new Worker(
      `const { Worker, SHARE_ENV, parentPort } = require("node:worker_threads"); const env = process.env; ${script}`,
      { eval: true, env: { ONLY_IN_THE_WORKER: "yes" } },
    );
    const [message] = await once(worker, "message");
    return message;
  }

  test("does not swap process.env when the constructor throws", async () => {
    const message = await inAWorker(`
      let threw = "did not throw";
      try {
        new Worker("", { eval: true, env: SHARE_ENV, workerData: () => {} });
      } catch (e) {
        threw = e.name;
      }
      parentPort.postMessage({ threw, processEnv: process.env === env, bunEnv: Bun.env === env });
    `);
    expect(message).toEqual({ threw: "DataCloneError", processEnv: true, bunEnv: true });
  });

  // Passes without the fix too. On POSIX only a value that an indexed write stores as it is makes the
  // read run script. When that write coerces, the assignment below throws: this row then needs another such value.
  test("reads process.env before it consumes the transfer list", async () => {
    const message = await inAWorker(`
      if (process.platform === "win32") {
        Object.defineProperty(env, "THROWS", { enumerable: true, get() { throw new RangeError("env read"); } });
      } else {
        env[5] = "string";
        env[5] = { toString() { throw new RangeError("env read"); } };
      }
      const buf = new ArrayBuffer(8);
      let threw = "did not throw";
      try {
        new Worker("", { eval: true, env: SHARE_ENV, workerData: buf, transferList: [buf] });
      } catch (e) {
        threw = e.name + ": " + e.message;
      }
      parentPort.postMessage({ threw, bytes: buf.byteLength, processEnv: process.env === env });
    `);
    expect(message).toEqual({ threw: "RangeError: env read", bytes: 8, processEnv: true });
  });
});

// The global Worker reads process.env after SerializedScriptValue::create returns when it has no transfer list.
test("env: SHARE_ENV on the global Worker: a process.env write and delete that a data getter makes reach the parent and the worker", async () => {
  const result = await run(`
    const SHARE_ENV = Symbol.for("nodejs.worker_threads.SHARE_ENV");
    const fromBefore = process.env;
    fromBefore.DELETED_BY_THE_GETTER = "not deleted";
    const data = {
      get getter() {
        fromBefore.WRITTEN_BY_THE_GETTER = "yes";
        delete fromBefore.DELETED_BY_THE_GETTER;
        return true;
      },
    };
    function sees() {
      return [process.env.WRITTEN_BY_THE_GETTER ?? null, process.env.DELETED_BY_THE_GETTER ?? null, process.env.WRITTEN_AFTER_THE_CONSTRUCTOR ?? null];
    }
    const worker = new Worker("data:text/javascript," + encodeURIComponent(sees + "; self.onmessage = () => postMessage(sees());"), { env: SHARE_ENV, data });
    process.env.WRITTEN_AFTER_THE_CONSTRUCTOR = "yes";
    const env = process.env;
    new Worker("data:text/javascript,", { env: SHARE_ENV });
    const second = { processEnv: process.env === env, bunEnv: Bun.env === env };
    worker.onmessage = event => {
      console.log(JSON.stringify({ parentSees: sees(), workerSees: event.data, second }));
      process.exit(0);
    };
    worker.postMessage("read");
  `);
  const sees = ["yes", null, "yes"];
  expect(result).toEqual({
    stdout: JSON.stringify({ parentSees: sees, workerSees: sees, second: { processEnv: true, bunEnv: true } }),
    stderr: "",
    exitCode: 0,
  });
});

describe.concurrent("in a process of its own", () => {
  // Joining an env tree swaps process.env for a shared view, and that cannot be undone. So the thread
  // joins only when its worker has a thread.
  test("env: SHARE_ENV does not swap process.env when execArgv is rejected", async () => {
    const result = await run(`
      const { Worker: ThreadWorker, SHARE_ENV } = require("node:worker_threads");
      const before = process.env;
      const kept = {};
      for (const [kind, WorkerCtor] of [["node:worker_threads", ThreadWorker], ["the global Worker", Worker]]) {
        try {
          new WorkerCtor(process.argv.at(-1), { env: SHARE_ENV, execArgv: ["--disallow-code-generation-from-strings"] });
          kept[kind] = "did not throw";
        } catch {
          kept[kind] = process.env === before;
        }
      }
      console.log(JSON.stringify(kept));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ "node:worker_threads": true, "the global Worker": true }),
      stderr: "",
      exitCode: 0,
    });
  });

  // The rows of node:worker_threads are in worker-transfer-list-node.test.ts.
  test("env: SHARE_ENV does not swap process.env when the global Worker throws while it serializes data", async () => {
    const result = await run(`
      const { MessageChannel } = require("node:worker_threads");
      const env = process.env;
      const { port1, port2 } = new MessageChannel();
      const shapes = {
        "data that cannot be cloned": () => ({ data: () => {} }),
        "a data getter that throws": () => ({ data: { get thrower() { throw new RangeError("data getter"); } } }),
        "a port that is not in transferList": () => ({ data: port2 }),
        "a data getter that detaches a buffer of transferList": () => {
          const buf = new ArrayBuffer(8);
          return { data: { buf, get detach() { return structuredClone(buf, { transfer: [buf] }); } }, transferList: [buf] };
        },
      };
      const threw = {};
      for (const [spelling, share] of [["env: SHARE_ENV", { env: Symbol.for("nodejs.worker_threads.SHARE_ENV") }], ["shareEnv: true", { shareEnv: true }]]) {
        threw[spelling] = {};
        for (const [shape, options] of Object.entries(shapes)) {
          try {
            new Worker(process.argv.at(-1), { ...share, ...options() });
            threw[spelling][shape] = "did not throw";
          } catch (e) {
            threw[spelling][shape] = e.name;
          }
        }
      }
      port1.close();
      console.log(JSON.stringify({ threw, processEnv: process.env === env, bunEnv: Bun.env === env }));
    `);
    const threw = {
      "data that cannot be cloned": "DataCloneError",
      "a data getter that throws": "RangeError",
      "a port that is not in transferList": "DataCloneError",
      "a data getter that detaches a buffer of transferList": "DataCloneError",
    };
    expect(result).toEqual({
      stdout: JSON.stringify({
        threw: { "env: SHARE_ENV": threw, "shareEnv: true": threw },
        processEnv: true,
        bunEnv: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // `expect().resolves` runs the loop of the host in place (see above), so these are tests of their own.
  test.each(["at birth", "while data is serialized"])(
    "env: SHARE_ENV does not swap process.env when the context of the Worker is stopped %s",
    async when => {
      using dir = tempDir("worker-stopped-context", {
        "stopped.test.ts": `
          import { AsyncLocalStorage } from "node:async_hooks";
          import { expect, test } from "bun:test";

          const SHARE_ENV = Symbol.for("nodejs.worker_threads.SHARE_ENV");
          const neverLoaded = ${JSON.stringify(neverLoaded)};
          const env = process.env;
          const print = worker =>
            console.log(JSON.stringify({ threadId: worker.threadId, processEnv: process.env === env, bunEnv: Bun.env === env }));

          test("at birth", async () => {
            const graph = new Bun.ModuleGraph();
            const inGraph = graph.run(() => AsyncLocalStorage.snapshot());
            graph.dispose();
            await new Promise(resolve => setImmediate(resolve));
            print(inGraph(() => new Worker(neverLoaded, { env: SHARE_ENV })));
          });

          test("while data is serialized", () => {
            const graph = new Bun.ModuleGraph();
            const hostTurn = new Promise(resolve => setImmediate(resolve));
            const data = {
              get stop() {
                graph.dispose();
                expect(hostTurn).resolves.toBeUndefined();
                return 1;
              },
            };
            print(graph.run(() => new Worker(neverLoaded, { env: SHARE_ENV, data })));
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "stopped.test.ts", "-t", when],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        printed: stdout.split("\n").filter(line => line.startsWith("{")),
        exitCode,
        stderr: exitCode ? stderr : "",
      }).toEqual({
        printed: [JSON.stringify({ threadId: -1, processEnv: true, bunEnv: true })],
        exitCode: 0,
        stderr: "",
      });
    },
  );

  // Without the fix this passes too: workerData was serialized before there was a Worker to release.
  test("a constructor that throws while it serializes workerData leaves no Worker, no 'worker' event and no open handle", async () => {
    const result = await run(`
      const { Worker: ThreadWorker } = require("node:worker_threads");
      const { heapStats } = require("bun:jsc");
      let events = 0;
      process.on("worker", () => events++);
      const uncloneable = () => ({ workerData: () => {} });
      const throwing = () => ({ workerData: { get thrower() { throw new Error("workerData getter"); } } });
      const thrown = new Set();
      for (let i = 0; i < 25; i++) {
        for (const WorkerCtor of [ThreadWorker, Worker]) {
          for (const options of [uncloneable, throwing]) {
            try {
              new WorkerCtor(process.argv.at(-1), options());
              thrown.add("did not throw");
            } catch (e) {
              thrown.add(e.name + ": " + e.message);
            }
          }
        }
      }
      setImmediate(() => {
        Bun.gc(true);
        const workers = heapStats().objectTypeCounts.Worker ?? 0;
        const collected = workers < 10 ? "yes" : workers + " of 100 remain";
        console.log(JSON.stringify({ thrown: [...thrown], events, collected }));
      });
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        thrown: ["DataCloneError: The object can not be cloned.", "Error: workerData getter"],
        events: 0,
        collected: "yes",
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a constructor that throws after it created the Worker starts no thread", async () => {
    using dir = tempDir("worker-transfer-list", {
      "entry.js": `require("node:fs").writeSync(1, "the entry ran\\n");`,
    });
    const result = await run(
      `
      const newTarget = function () {}.bind(null);
      Object.defineProperty(newTarget, "prototype", { get() { throw new Error("prototype getter"); } });
      try {
        Reflect.construct(Worker, [process.argv.at(-1)], newTarget);
        console.log("did not throw");
      } catch (e) {
        console.log(e.message);
      }
    `,
      join(String(dir), "entry.js"),
    );
    expect(result).toEqual({ stdout: "prototype getter", stderr: "", exitCode: 0 });
  });
});

// Runs alone: it compiles a shim first, and beside the other children a debug build comes close to the default timeout.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
test.skipIf(!isLinux || !cc)("env: SHARE_ENV does not swap process.env when the OS refuses the thread", async () => {
  using dir = tempDir("worker-refused-thread", {
    "entry.js": "",
    "refuse.c": /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <unistd.h>

/* Refuses every thread while the file that REFUSE_THREADS names exists. */
int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  static int (*real)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
  if (!real) real = dlsym(RTLD_NEXT, "pthread_create");
  const char *flag = getenv("REFUSE_THREADS");
  if (flag && access(flag, F_OK) == 0) return EAGAIN;
  return real(thread, attr, start, arg);
}
`,
  });
  const shim = join(String(dir), "refuse.so");
  {
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(String(dir), "refuse.c"), "-ldl", "-lpthread"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      compile.stdout.text(),
      compile.stderr.text(),
      compile.exited,
    ]);
    if (exitCode !== 0) throw new Error(`shim compile failed: ${stdout}${stderr}`);
  }

  const result = await run(
    `
    const { Worker: ThreadWorker, SHARE_ENV } = require("node:worker_threads");
    const { writeFileSync, rmSync } = require("node:fs");
    const env = process.env;
    const flag = env.REFUSE_THREADS;
    const refused = {};
    for (const [kind, WorkerCtor] of [["node:worker_threads", ThreadWorker], ["the global Worker", Worker]]) {
      writeFileSync(flag, "");
      try {
        new WorkerCtor(process.argv.at(-1), { env: SHARE_ENV });
        refused[kind] = "did not throw";
      } catch (e) {
        refused[kind] = e.message;
      }
      rmSync(flag);
    }
    console.log(JSON.stringify({ refused, processEnv: process.env === env, bunEnv: Bun.env === env }));
  `,
    join(String(dir), "entry.js"),
    {
      LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
      REFUSE_THREADS: join(String(dir), "refuse"),
      // Or JSC can start its helper thread for MarkedBlocks while the shim refuses, and abort.
      BUN_JSC_useWarmUpMarkedBlocks: "0",
    },
  );
  const refused = "Failed to spawn worker thread";
  expect(result).toEqual({
    stdout: JSON.stringify({
      refused: { "node:worker_threads": refused, "the global Worker": refused },
      processEnv: true,
      bunEnv: true,
    }),
    stderr: "",
    exitCode: 0,
  });
});
