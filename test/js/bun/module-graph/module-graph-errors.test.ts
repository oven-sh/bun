import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const { ModuleGraph } = Bun.unsafe as any;

// Every way this file makes graph code fail. `error` is whatever the caller wants thrown or rejected.
const faults = `
  import { EventEmitter } from "node:events";
  import { readFile } from "node:fs";

  export const throwIn = {
    setTimeout(error) { setTimeout(() => { throw error; }, 0); },
    setInterval(error) { const timer = setInterval(() => { clearInterval(timer); throw error; }, 1); },
    setImmediate(error) { setImmediate(() => { throw error; }); },
    queueMicrotask(error) { queueMicrotask(() => { throw error; }); },
    nextTick(error) { process.nextTick(() => { throw error; }); },
    readFile(error) { readFile(import.meta.path, () => { throw error; }); },
  };
  export const listeners = {
    emitter(error) { const emitter = new EventEmitter(); emitter.on("fault", () => { throw error; }); return emitter; },
    target(error) { const target = new EventTarget(); target.addEventListener("fault", () => { throw error; }); return target; },
    abort(error) { const controller = new AbortController(); controller.signal.addEventListener("abort", () => { throw error; }); return controller; },
  };
  export const rejectIn = {
    asyncFunction(error) { (async () => { throw error; })(); },
    promiseReject(error) { Promise.reject(error); },
    executor(error) { new Promise((resolve, reject) => { reject(error); }); },
    executorThrow(error) { new Promise(() => { throw error; }); },
    withResolvers(error) { const { reject } = Promise.withResolvers(); reject(error); },
    thenCallback(error) { Promise.resolve().then(() => { throw error; }); },
    catchCallback(error) { Promise.reject(1).catch(() => { throw error; }); },
    finallyCallback(error) { Promise.resolve().finally(() => { throw error; }); },
    afterAwait(error, awaited) { (async () => { await awaited; throw error; })(); },
    asyncGenerator(error) { (async function* () { throw error; })().next(); },
    asyncGeneratorSecondNext(error) {
      const generator = (async function* () { yield 1; throw error; })();
      generator.next().then(() => { generator.next(); });
    },
    rejectedLater(error) { const { reject } = Promise.withResolvers(); setTimeout(() => { reject(error); }, 0); },
    // Tail calls: this function's frame is gone by the time the promise is rejected.
    tailCall: error => Promise.reject(error),
    tailCallOfOwnError: message => Promise.reject(new Error(message)),
    tailCallOfOwnErrorWithStackRead: message => {
      const error = new Error(message);
      error.stack;
      return Promise.reject(error);
    },
  };
  export const create = {
    error(message) { const error = new Error(message); create.last = error; return error; },
    last: undefined,
  };
  export const throwOwnErrorIn = {
    nextTick(message) { const error = create.error(message); process.nextTick(() => { throw error; }); },
    readFile(message) { const error = create.error(message); readFile(import.meta.path, () => { throw error; }); },
    setTimeoutWithStackRead(message) { const error = create.error(message); error.stack; setTimeout(() => { throw error; }, 0); },
  };
  export const rejectOwnErrorWithStackRead = message => { const error = create.error(message); error.stack; Promise.reject(error); };
  export const call = fn => { fn(); };
  export const callInTimer = fn => { setTimeout(() => { fn(); }, 0); };
  export const throwNow = error => { throw error; };
  export const rejected = error => { const promise = Promise.reject(error); return { promise }; };
  export const object = { get throwing() { throw new Error("getter"); } };
`;

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(condition: () => boolean) {
  while (!condition()) await nextTurn();
}

// The start of every subprocess fixture: a log of everything the process and the graphs are told about.
const prelude = `
  const { ModuleGraph } = Bun.unsafe;
  const log = [];
  const show = value => (value instanceof Error ? value.message : typeof value + " " + String(value));
  process.on("uncaughtException", error => log.push("process uncaughtException: " + show(error)));
  process.on("unhandledRejection", error => log.push("process unhandledRejection: " + show(error)));
  process.on("rejectionHandled", () => log.push("process rejectionHandled"));
  const onError = name => error => log.push(name + ".onError: " + show(error));
  const nextTurn = () => new Promise(resolve => setImmediate(resolve));
  // Each fault is reported once the event loop gets to it; wait for that report.
  async function reported(act, count = 1) {
    const before = log.length;
    act();
    while (log.length < before + count) await nextTurn();
  }
`;

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("Bun.unsafe.ModuleGraph onError", () => {
  describe("uncaught exceptions of the graph's code", () => {
    test.each(["setTimeout", "setInterval", "setImmediate", "queueMicrotask"])("thrown in %s", async source => {
      using dir = tempDir("module-graph-errors-throw-in", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { throwIn } = await graph.import(join(String(dir), "faults.mjs"));

      const error = new Error(source);
      throwIn[source](error);
      await until(() => errors.length > 0);
      expect(errors).toEqual([error]);
      expect(errors[0]).toBe(error);
    });

    test.each(["nextTick", "readFile", "setTimeoutWithStackRead"])(
      "the graph's own Error thrown in %s",
      async source => {
        using dir = tempDir("module-graph-errors-throw-own", { "faults.mjs": faults });
        const errors: unknown[] = [];
        using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
        const { throwOwnErrorIn, create } = await graph.import(join(String(dir), "faults.mjs"));

        throwOwnErrorIn[source](source);
        await until(() => errors.length > 0);
        expect(errors).toEqual([expect.objectContaining({ message: source })]);
        expect(errors[0]).toBe(create.last);
      },
    );

    // The exception's own stack (the graph's callback threw it) decides, whoever created the value.
    test.concurrent.each(["nextTick", "readFile"])("a value the graph did not create, thrown in %s", async source => {
      using dir = tempDir("module-graph-errors-throw-foreign", {
        "faults.mjs": faults,
        "main.mjs": `
            ${prelude}
            const { throwIn } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/faults.mjs");
            const source = process.argv[2];
            await reported(() => throwIn[source](new Error("host Error")));
            await reported(() => throwIn[source]("a string"));
            console.log(JSON.stringify(log));
          `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs", source]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["graph.onError: host Error", "graph.onError: string a string"]);
      expect(exitCode).toBe(0);
    });

    test("thrown by an EventEmitter listener the host emits to", async () => {
      using dir = tempDir("module-graph-errors-emitter", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { listeners } = await graph.import(join(String(dir), "faults.mjs"));

      const error = new Error("listener");
      const emitter = listeners.emitter(error);
      setImmediate(() => emitter.emit("fault"));
      await until(() => errors.length > 0);
      expect(errors[0]).toBe(error);
      expect(errors).toHaveLength(1);
    });

    test("thrown by an EventTarget listener the host dispatches to", async () => {
      using dir = tempDir("module-graph-errors-event-target", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { listeners } = await graph.import(join(String(dir), "faults.mjs"));

      const error = new Error("listener");
      const target = listeners.target(error);
      const dispatched: boolean[] = [];
      setImmediate(() => dispatched.push(target.dispatchEvent(new Event("fault"))));
      await until(() => errors.length > 0);
      expect(errors[0]).toBe(error);
      // dispatchEvent() itself does not throw: the listener's exception is reported, not propagated.
      expect({ dispatched, reports: errors.length }).toEqual({ dispatched: [true], reports: 1 });
    });

    test("thrown by an AbortSignal listener when the host aborts", async () => {
      using dir = tempDir("module-graph-errors-abort", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { listeners } = await graph.import(join(String(dir), "faults.mjs"));

      const error = new Error("abort listener");
      const controller = listeners.abort(error);
      setImmediate(() => controller.abort());
      await until(() => errors.length > 0);
      expect(errors[0]).toBe(error);
      expect({ aborted: controller.signal.aborted, reports: errors.length }).toEqual({ aborted: true, reports: 1 });
    });

    test.each([["a string"], [42], [0n], [undefined], [null], [{ plain: "object" }], [Symbol.for("thrown")]])(
      "a thrown %p arrives as is",
      async value => {
        using dir = tempDir("module-graph-errors-throw-value", { "faults.mjs": faults });
        const calls: unknown[][] = [];
        using graph = new ModuleGraph({ onError: (...args: unknown[]) => calls.push(args) });
        const { throwIn } = await graph.import(join(String(dir), "faults.mjs"));

        throwIn.setTimeout(value);
        await until(() => calls.length > 0);
        expect(calls).toEqual([[value]]);
        expect(calls[0][0]).toBe(value);
      },
    );

    test("a stack overflow in a timer", async () => {
      using dir = tempDir("module-graph-errors-overflow", {
        "overflow.mjs": `
          export const overflowInTimer = () => {
            setTimeout(() => {
              const recurse = () => recurse() + 1;
              recurse();
            }, 0);
          };
        `,
      });
      const errors: any[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { overflowInTimer } = await graph.import(join(String(dir), "overflow.mjs"));

      overflowInTimer();
      await until(() => errors.length > 0);
      expect(errors.map(error => [error instanceof RangeError, error.message])).toEqual([
        [true, "Maximum call stack size exceeded."],
      ]);
    });

    test("what host code catches is not reported", async () => {
      using dir = tempDir("module-graph-errors-caught", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { object, throwNow, rejected, throwIn } = await graph.import(join(String(dir), "faults.mjs"));

      const caught: unknown[] = [];
      try {
        object.throwing;
      } catch (error: any) {
        caught.push(error.message);
      }
      try {
        throwNow(new Error("thrown to the host"));
      } catch (error: any) {
        caught.push(error.message);
      }
      try {
        await rejected(new Error("awaited by the host")).promise;
      } catch (error: any) {
        caught.push(error.message);
      }

      // Anything reported for the above would come before this one.
      const last = new Error("the only report");
      throwIn.setTimeout(last);
      await until(() => errors.length > 0);
      expect({ caught, errors }).toEqual({
        caught: ["getter", "thrown to the host", "awaited by the host"],
        errors: [last],
      });
    });

    describe("whatever kind of graph function the host's timer reaches", () => {
      const shapes = `
        let value;
        export const willThrow = next => { value = next; };
        const fail = () => { throw value; };
        export class Thrower {
          static fail() { throw value; }
          fail() { throw value; }
          get failing() { throw value; }
          set failing(ignored) { throw value; }
          static { this.fromStaticBlock = () => { throw value; }; }
        }
        export const nested = (() => () => () => { throw value; })()();
        export const proxy = new Proxy({}, { get() { throw value; } });
        export const coerced = { toString() { throw value; }, [Symbol.toPrimitive]: undefined };
        export const iterable = { [Symbol.iterator]() { return { next() { throw value; } }; } };
        export const rejectingThenable = { then(resolve, reject) { reject(value); } };
        export async function* asyncGenerator() { throw value; }
        export const tagged = strings => { throw value; };
        export const withDefault = (argument = fail()) => argument;
        export const sort = () => [3, 2, 1].sort(fail);
        export const parse = () => JSON.parse("[1]", fail);
        export const replace = () => "abc".replace(/b/, fail);
      `;
      const operations: Record<string, (namespace: any) => unknown> = {
        "a static method": namespace => namespace.Thrower.fail(),
        "a method": namespace => new namespace.Thrower().fail(),
        "a getter": namespace => new namespace.Thrower().failing,
        "a setter": namespace => (new namespace.Thrower().failing = 1),
        "a function made in a static block": namespace => namespace.Thrower.fromStaticBlock(),
        "a bound function": namespace => namespace.Thrower.fail.bind(null)(),
        "a nested closure": namespace => namespace.nested(),
        "Reflect.apply": namespace => Reflect.apply(namespace.Thrower.fail, undefined, []),
        "a Proxy trap": namespace => namespace.proxy.anything,
        "toString called by the host's String()": namespace => String(namespace.coerced),
        "an iterator's next() called by the host's for-of": namespace => {
          for (const _ of namespace.iterable);
        },
        "an iterator's next() called by Array.from": namespace => Array.from(namespace.iterable),
        "a tagged template": namespace => namespace.tagged`template`,
        "a default parameter initializer": namespace => namespace.withDefault(),
        "an Array.prototype.sort comparator": namespace => namespace.sort(),
        "a JSON.parse reviver": namespace => namespace.parse(),
        "a String.prototype.replace callback": namespace => namespace.replace(),
        "the host's forEach callback calling it": namespace => [1].forEach(() => namespace.Thrower.fail()),
        "the host's try/finally around it": namespace => {
          try {
            namespace.Thrower.fail();
          } finally {
            Math.max(1, 2);
          }
        },
      };

      test.each(Object.keys(operations))("%s", async name => {
        using dir = tempDir("module-graph-errors-shapes", { "shapes.mjs": shapes });
        const errors: unknown[] = [];
        using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
        const namespace = await graph.import(join(String(dir), "shapes.mjs"));

        // Not an Error: only the stack of the exception can say whose it is.
        namespace.willThrow(name);
        setTimeout(() => {
          operations[name](namespace);
        }, 0);
        await until(() => errors.length > 0);
        expect(errors).toEqual([name]);
      });

      test("an async generator, and a thenable that calls reject()", async () => {
        using dir = tempDir("module-graph-errors-shapes-rejections", { "shapes.mjs": shapes });
        const errors: unknown[] = [];
        using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
        const namespace = await graph.import(join(String(dir), "shapes.mjs"));

        namespace.willThrow("async generator");
        setTimeout(() => {
          namespace.asyncGenerator().next();
        }, 0);
        await until(() => errors.length === 1);
        namespace.willThrow("thenable");
        setTimeout(() => {
          Promise.resolve(namespace.rejectingThenable);
        }, 0);
        await until(() => errors.length === 2);
        expect(errors).toEqual(["async generator", "thenable"]);
      });

      // Attribution is by stack, and here no stack is left that names the graph: the job that calls then() catches what it
      // throws and rejects the promise by calling back into the VM, which forgets the exception; the value was not made
      // by the graph either. The graph's own Error, thrown the same way, is attributed.
      test.concurrent("a thenable whose then() throws a value the graph did not make is nobody's", async () => {
        using dir = tempDir("module-graph-errors-thenable", {
          "thenable.mjs": `
            export const thenable = value => ({ then() { throw value; } });
            export const resolveWithThenable = value => { Promise.resolve(thenable(value)); };
          `,
          "main.mjs": `
            ${prelude}
            const { thenable, resolveWithThenable } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/thenable.mjs");
            await reported(() => resolveWithThenable("resolved by the graph"));
            await reported(() => { Promise.resolve(thenable("resolved by the host")); });
            console.log(JSON.stringify(log, null, 2));
          `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual([
          "process unhandledRejection: string resolved by the graph",
          "process unhandledRejection: string resolved by the host",
        ]);
        expect(exitCode).toBe(0);
      });

      // The same: generatorResume catches and rethrows, so the exception the host sees was thrown by a builtin.
      test.concurrent("a generator that throws a value the graph did not make is nobody's", async () => {
        using dir = tempDir("module-graph-errors-generator", {
          "generator.mjs": `
            export function* throwing(value) { throw value; }
            export function* throwingAfterYield(value) { yield 1; throw value; }
          `,
          "main.mjs": `
            ${prelude}
            const { throwing, throwingAfterYield } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/generator.mjs");
            await reported(() => { setTimeout(() => { throwing("a string").next(); }, 0); });
            await reported(() => { setTimeout(() => { throwing(new Error("host Error")).next(); }, 0); });
            await reported(() => { setTimeout(() => { const generator = throwingAfterYield("after a yield"); generator.next(); generator.next(); }, 0); });
            console.log(JSON.stringify(log, null, 2));
          `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual([
          "process uncaughtException: string a string",
          "process uncaughtException: host Error",
          "process uncaughtException: string after a yield",
        ]);
        expect(exitCode).toBe(0);
      });
    });

    test("thrown by a MessagePort's onmessage and by a Bun.spawn onExit callback", async () => {
      using dir = tempDir("module-graph-errors-native-callbacks", {
        "callbacks.mjs": `
          export const inMessagePort = error => {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = () => { port1.close(); throw error; };
            port2.postMessage("fault");
          };
          export const inSpawnExit = (error, cmd, env) => {
            Bun.spawn({ cmd, env, stdout: "ignore", stderr: "ignore", onExit() { throw error; } });
          };
        `,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { inMessagePort, inSpawnExit } = await graph.import(join(String(dir), "callbacks.mjs"));

      const fromPort = new Error("onmessage");
      inMessagePort(fromPort);
      await until(() => errors.length === 1);
      const fromExit = new Error("onExit");
      inSpawnExit(fromExit, [bunExe(), "--version"], bunEnv);
      await until(() => errors.length === 2);
      expect(errors).toEqual([fromPort, fromExit]);
    });

    test.concurrent("CommonJS is shared: its functions are nobody's, its callers may be the graph's", async () => {
      using dir = tempDir("module-graph-errors-commonjs", {
        "shared.cjs": `
          exports.throwNow = value => { throw value; };
          exports.throwInTimer = value => { setTimeout(() => { throw value; }, 0); };
          exports.rejectNow = value => { Promise.reject(value); };
        `,
        "uses-shared.mjs": `
          import shared from "./shared.cjs";
          export { shared };
          export const callSharedInTimer = (name, value) => { setTimeout(() => { shared[name](value); }, 0); };
        `,
        "main.mjs": `
          ${prelude}
          const { shared, callSharedInTimer } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/uses-shared.mjs");
          await reported(() => callSharedInTimer("throwNow", "thrown under the graph's timer"));
          await reported(() => callSharedInTimer("rejectNow", "rejected under the graph's timer"));
          await reported(() => { setTimeout(() => shared.throwNow("thrown under the host's timer"), 0); });
          await reported(() => { setTimeout(() => shared.rejectNow("rejected under the host's timer"), 0); });
          // The graph's frame is long gone when CommonJS's own timer fires.
          await reported(() => callSharedInTimer("throwInTimer", "thrown in the CommonJS module's timer"));
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: string thrown under the graph's timer",
        "graph.onError: string rejected under the graph's timer",
        "process uncaughtException: string thrown under the host's timer",
        "process unhandledRejection: string rejected under the host's timer",
        "process uncaughtException: string thrown in the CommonJS module's timer",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("modules the graph's entry imports, statically and dynamically", async () => {
      using dir = tempDir("module-graph-errors-dependencies", {
        "static-dependency.mjs": `export const throwFromStatic = value => { throw value; };`,
        "dynamic-dependency.mjs": `export const throwFromDynamic = value => { throw value; };`,
        "throws-when-evaluated.mjs": `throw new Error("thrown while a dropped import() evaluated it");`,
        "entry.mjs": `
          export * from "./static-dependency.mjs";
          export const load = () => import("./dynamic-dependency.mjs");
          export const dropImport = specifier => { import(specifier); };
        `,
        "main.mjs": `
          ${prelude}
          const entry = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/entry.mjs");
          const { throwFromDynamic } = await entry.load();
          await reported(() => { setTimeout(() => entry.throwFromStatic("static dependency"), 0); });
          await reported(() => { setTimeout(() => throwFromDynamic("dynamic dependency"), 0); });
          await reported(() => entry.dropImport("./throws-when-evaluated.mjs"));
          // Nothing of the graph's is on any stack when the resolver's error rejects the import() promise.
          await reported(() => entry.dropImport("./missing.mjs"));
          console.log(JSON.stringify(log.map(line => line.split(" imported from ")[0]), null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: string static dependency",
        "graph.onError: string dynamic dependency",
        "graph.onError: thrown while a dropped import() evaluated it",
        "process unhandledRejection: Cannot find module './missing.mjs'",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a Bun.serve fetch handler: the server handles it, onError does not", async () => {
      using dir = tempDir("module-graph-errors-serve", {
        "server.mjs": `
          export const serve = (options, error) => Bun.serve({ port: 0, ...options, fetch() { throw error; } });
          export const serveAsync = (options, error) => Bun.serve({ port: 0, ...options, async fetch() { await null; throw error; } });
          export const serveWithOwnHandler = error => Bun.serve({
            port: 0,
            fetch() { throw error; },
            error(thrown) { return new Response("graph handler: " + thrown.message, { status: 500 }); },
          });
        `,
        "main.mjs": `
          ${prelude}
          const graph = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/server.mjs");
          const responses = [];
          const seen = [];
          const error = thrown => { seen.push(thrown); return new Response("host handler: " + thrown.message, { status: 500 }); };
          const thrown = [new Error("sync"), new Error("async"), new Error("own")];
          for (const server of [graph.serve({ error }, thrown[0]), graph.serveAsync({ error }, thrown[1]), graph.serveWithOwnHandler(thrown[2])]) {
            const response = await fetch(server.url);
            responses.push([response.status, await response.text()]);
            await server.stop(true);
          }
          await nextTurn();
          console.log(JSON.stringify({ responses, sameErrors: seen.map((error, i) => error === thrown[i]), log }));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        responses: [
          [500, "host handler: sync"],
          [500, "host handler: async"],
          [500, "graph handler: own"],
        ],
        sameErrors: [true, true],
        log: [],
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent(
      "a Bun.serve fetch handler without an error handler: the server prints it and answers 500",
      async () => {
        using dir = tempDir("module-graph-errors-serve-default", {
          "server.mjs": `
          export const serve = () => Bun.serve({ port: 0, fetch() { throw new Error("thrown by the fetch handler"); } });
        `,
          "main.mjs": `
          ${prelude}
          const { serve } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/server.mjs");
          const server = serve();
          const response = await fetch(server.url);
          await server.stop(true);
          await nextTurn();
          console.log(JSON.stringify({ status: response.status, log }));
        `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
        expect(stderr).toContain("thrown by the fetch handler");
        expect(JSON.parse(stdout)).toEqual({ status: 500, log: [] });
        // As for a host server: an error Bun.serve had to print sets the exit code.
        expect(exitCode).toBe(1);
      },
    );
  });

  describe("unhandled rejections of the graph's code", () => {
    test.each([
      "asyncFunction",
      "promiseReject",
      "executor",
      "executorThrow",
      "withResolvers",
      "thenCallback",
      "catchCallback",
      "finallyCallback",
      "afterAwait",
      "asyncGenerator",
      "asyncGeneratorSecondNext",
      "rejectedLater",
    ])("rejected in %s", async source => {
      using dir = tempDir("module-graph-errors-reject-in", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { rejectIn } = await graph.import(join(String(dir), "faults.mjs"));

      // Created by the host: only the stack at the time of the rejection says it is the graph's.
      const error = new Error(source);
      rejectIn[source](error, Promise.resolve("a host promise"));
      await until(() => errors.length > 0);
      expect(errors).toEqual([error]);
      expect(errors[0]).toBe(error);
    });

    test.each([["a string"], [42], [undefined], [null], [{ plain: "object" }], [Symbol.for("rejected")]])(
      "a %p rejected while the graph's frame is live arrives as is",
      async value => {
        using dir = tempDir("module-graph-errors-reject-value", { "faults.mjs": faults });
        const calls: unknown[][] = [];
        using graph = new ModuleGraph({ onError: (...args: unknown[]) => calls.push(args) });
        const { rejectIn } = await graph.import(join(String(dir), "faults.mjs"));

        rejectIn.promiseReject(value);
        rejectIn.asyncFunction(value);
        rejectIn.thenCallback(value);
        await until(() => calls.length === 3);
        expect(calls).toEqual([[value], [value], [value]]);
        expect(calls.map(([arg]) => arg === value)).toEqual([true, true, true]);
      },
    );

    test.concurrent("from a tail call only the graph's own, unread Error is attributed", async () => {
      using dir = tempDir("module-graph-errors-tail-call", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const { rejectIn } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/faults.mjs");
          await reported(() => { rejectIn.tailCallOfOwnError("own Error"); });
          await reported(() => { rejectIn.tailCallOfOwnErrorWithStackRead("own Error, stack read"); });
          await reported(() => { rejectIn.tailCall(new Error("host Error")); });
          await reported(() => { rejectIn.tailCall("a string"); });
          await reported(() => { rejectIn.tailCall(undefined); });
          await reported(() => { rejectIn.tailCall({ toString: () => "an object" }); });
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: own Error",
        "process unhandledRejection: own Error, stack read",
        "process unhandledRejection: host Error",
        "process unhandledRejection: string a string",
        "process unhandledRejection: undefined undefined",
        "process unhandledRejection: object an object",
      ]);
      expect(exitCode).toBe(0);
    });

    test("an Error whose stack was read, rejected while the graph's frame is live", async () => {
      using dir = tempDir("module-graph-errors-stack-read", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { rejectOwnErrorWithStackRead, create } = await graph.import(join(String(dir), "faults.mjs"));

      rejectOwnErrorWithStackRead("stack was read");
      await until(() => errors.length > 0);
      expect(errors).toEqual([expect.objectContaining({ message: "stack was read" })]);
      expect(errors[0]).toBe(create.last);
    });

    test("an Error the graph created is the graph's even when host code throws or rejects it", async () => {
      using dir = tempDir("module-graph-errors-created", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { create } = await graph.import(join(String(dir), "faults.mjs"));

      const rejectedByHost = create.error("rejected by the host");
      Promise.reject(rejectedByHost);
      await until(() => errors.length === 1);

      const thrownByHost = create.error("thrown by the host");
      setTimeout(() => {
        throw thrownByHost;
      }, 0);
      await until(() => errors.length === 2);

      const thrownInHostAsyncFunction = create.error("thrown in the host's async function");
      (async () => {
        throw thrownInHostAsyncFunction;
      })();
      await until(() => errors.length === 3);
      expect(errors).toEqual([rejectedByHost, thrownByHost, thrownInHostAsyncFunction]);
    });

    test("an async function the module starts while it is evaluated", async () => {
      using dir = tempDir("module-graph-errors-evaluation", {
        "starts-failing-work.mjs": `
          export const error = new Error("started during evaluation");
          (async () => { throw error; })();
          (async () => { await null; throw "after an await"; })();
          export const evaluated = true;
        `,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const namespace = await graph.import(join(String(dir), "starts-failing-work.mjs"));

      await until(() => errors.length === 2);
      expect(namespace.evaluated).toBe(true);
      expect(errors).toEqual([namespace.error, "after an await"]);
    });

    test("a failed graph.import() rejects the caller's promise and is not an onError event", async () => {
      using dir = tempDir("module-graph-errors-import-fails", {
        "faults.mjs": faults,
        "throws.mjs": `throw new Error("thrown during evaluation");`,
        "throws-after-await.mjs": `await null; throw new Error("thrown after top-level await");`,
        "syntax-error.mjs": `export const = ;`,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });

      const results = await Promise.allSettled([
        graph.import(join(String(dir), "throws.mjs")),
        graph.import(join(String(dir), "throws-after-await.mjs")),
        graph.import(join(String(dir), "syntax-error.mjs")),
        graph.import(join(String(dir), "missing.mjs")),
      ]);

      const { throwIn } = await graph.import(join(String(dir), "faults.mjs"));
      const last = new Error("the only report");
      throwIn.setTimeout(last);
      await until(() => errors.length > 0);
      expect({ statuses: results.map(result => result.status), errors }).toEqual({
        statuses: ["rejected", "rejected", "rejected", "rejected"],
        errors: [last],
      });
    });

    // The promise graph.import() returns is the caller's, like the one import() returns: a failure nobody handles is an
    // unhandled rejection, which the graph's onError takes when it was the graph's code that threw.
    test.concurrent("a failed graph.import() nobody handles is reported", async () => {
      using dir = tempDir("module-graph-errors-import-unhandled", {
        "throws.mjs": `throw new Error("thrown during evaluation");`,
        "host-throws.mjs": `throw new Error("thrown during the host's evaluation");`,
        "main.mjs": `
          ${prelude}
          const graph = new ModuleGraph({ onError: onError("graph") });
          await reported(() => { import(import.meta.dir + "/host-throws.mjs"); });
          await reported(() => { graph.import(import.meta.dir + "/throws.mjs"); });
          await reported(() => { Promise.reject(new Error("made after the failed graph.import()")); });
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "process unhandledRejection: thrown during the host's evaluation",
        "graph.onError: thrown during evaluation",
        "process unhandledRejection: made after the failed graph.import()",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a promise native code rejects is the graph's only once the graph's code awaits it", async () => {
      using dir = tempDir("module-graph-errors-native-rejection", {
        "reads.mjs": `
          import { promises } from "node:fs";
          export const awaited = path => { (async () => { await promises.readFile(path); })(); };
          export const chained = path => { promises.readFile(path).then(() => {}); };
          export const dropped = path => { promises.readFile(path); };
        `,
        "main.mjs": `
          ${prelude}
          const reads = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/reads.mjs");
          for (const name of ["awaited", "chained", "dropped"]) await reported(() => reads[name](import.meta.dir + "/missing-" + name));
          console.log(JSON.stringify(log.map(line => line.split(", open")[0]), null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: ENOENT: no such file or directory",
        "process unhandledRejection: ENOENT: no such file or directory",
        "process unhandledRejection: ENOENT: no such file or directory",
      ]);
      expect(exitCode).toBe(0);
    });

    test("the same Error rejected twice is reported twice", async () => {
      using dir = tempDir("module-graph-errors-twice", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { rejectIn, throwIn } = await graph.import(join(String(dir), "faults.mjs"));

      const error = new Error("twice");
      rejectIn.promiseReject(error);
      rejectIn.asyncFunction(error);
      throwIn.setTimeout(error);
      await until(() => errors.length === 3);
      expect(errors).toEqual([error, error, error]);
    });

    test("a deep stack", async () => {
      using dir = tempDir("module-graph-errors-deep", {
        "deep.mjs": `
          export function rejectAtDepth(depth, value) {
            if (depth === 0) {
              Promise.reject(value);
              return 0;
            }
            return rejectAtDepth(depth - 1, value) + 1;
          }
        `,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { rejectAtDepth } = await graph.import(join(String(dir), "deep.mjs"));

      // Not an Error, so only the live stack can attribute it.
      expect(rejectAtDepth(5000, "rejected 5000 frames deep")).toBe(5000);
      await until(() => errors.length > 0);
      expect(errors).toEqual(["rejected 5000 frames deep"]);
    });
  });

  describe("ownership", () => {
    const files = {
      "faults.mjs": faults,
    };

    test("the innermost graph frame decides between graphs", async () => {
      using dir = tempDir("module-graph-errors-innermost", files);
      const file = join(String(dir), "faults.mjs");
      const reports: [string, unknown][] = [];
      using graphA = new ModuleGraph({ onError: (error: unknown) => reports.push(["a", error]) });
      using graphB = new ModuleGraph({ onError: (error: unknown) => reports.push(["b", error]) });
      const a = await graphA.import(file);
      const b = await graphB.import(file);

      // b's timer callback calls a's function.
      b.callInTimer(() => a.throwNow("a throws inside b's timer"));
      await until(() => reports.length === 1);
      b.callInTimer(() => a.rejectIn.promiseReject("a rejects inside b's timer"));
      await until(() => reports.length === 2);
      // a's function calls b's function which calls a host function that throws.
      a.callInTimer(() =>
        b.call(() => {
          throw "the host throws inside b inside a's timer";
        }),
      );
      await until(() => reports.length === 3);
      a.callInTimer(() => b.call(() => a.call(() => b.rejectIn.promiseReject("b is innermost of a-b-a-b"))));
      await until(() => reports.length === 4);

      expect(reports).toEqual([
        ["a", "a throws inside b's timer"],
        ["a", "a rejects inside b's timer"],
        ["b", "the host throws inside b inside a's timer"],
        ["b", "b is innermost of a-b-a-b"],
      ]);
    });

    test("a host function the graph calls, and a graph function a host timer calls", async () => {
      using dir = tempDir("module-graph-errors-host-frames", files);
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { callInTimer, call, throwNow, rejectIn } = await graph.import(join(String(dir), "faults.mjs"));

      callInTimer(() => {
        throw "host function in the graph's timer";
      });
      await until(() => errors.length === 1);
      callInTimer(() => {
        Promise.reject("host function rejecting in the graph's timer");
      });
      await until(() => errors.length === 2);
      setTimeout(() => throwNow("graph function in the host's timer"), 0);
      await until(() => errors.length === 3);
      setTimeout(() => {
        rejectIn.promiseReject("graph function rejecting in the host's timer");
      }, 0);
      await until(() => errors.length === 4);
      setTimeout(
        () =>
          call(() => {
            throw "host function called by the graph in the host's timer";
          }),
        0,
      );
      await until(() => errors.length === 5);

      expect(errors).toEqual([
        "host function in the graph's timer",
        "host function rejecting in the graph's timer",
        "graph function in the host's timer",
        "graph function rejecting in the host's timer",
        "host function called by the graph in the host's timer",
      ]);
    });

    test("a host function in `globals` that throws when the graph's timer calls it", async () => {
      using dir = tempDir("module-graph-errors-globals-function", {
        "uses-global.mjs": `
          export const callGlobalInTimer = () => { setTimeout(() => { fail("from the global"); }, 0); };
        `,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({
        globals: {
          fail(message: string) {
            throw new Error(message);
          },
        },
        onError: (error: any) => errors.push(error.message),
      });
      const { callGlobalInTimer } = await graph.import(join(String(dir), "uses-global.mjs"));

      callGlobalInTimer();
      await until(() => errors.length > 0);
      expect(errors).toEqual(["from the global"]);
    });

    test("two graphs of the same module each get their own", async () => {
      using dir = tempDir("module-graph-errors-interleaved", files);
      const file = join(String(dir), "faults.mjs");
      const reports: { a: unknown[]; b: unknown[] } = { a: [], b: [] };
      using graphA = new ModuleGraph({ onError: (error: unknown) => reports.a.push(error) });
      using graphB = new ModuleGraph({ globals: { tenant: "b" }, onError: (error: unknown) => reports.b.push(error) });
      const namespaces = { a: await graphA.import(file), b: await graphB.import(file) };

      const expected: { a: string[]; b: string[] } = { a: [], b: [] };
      for (let i = 0; i < 42; i++) {
        const name = i % 2 ? "a" : "b";
        namespaces[name].rejectIn[["promiseReject", "asyncFunction", "thenCallback"][i % 3]](name + i);
        expected[name].push(name + i);
      }
      await until(() => reports.a.length + reports.b.length === 42);
      expect({ a: reports.a.toSorted(), b: reports.b.toSorted() }).toEqual({
        a: expected.a.toSorted(),
        b: expected.b.toSorted(),
      });
    });

    test("thirty graphs", async () => {
      using dir = tempDir("module-graph-errors-many", files);
      const file = join(String(dir), "faults.mjs");
      const reports: [number, unknown][] = [];
      const namespaces = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          new ModuleGraph({ onError: (error: unknown) => reports.push([i, error]) }).import(file),
        ),
      );

      namespaces.forEach((namespace, i) =>
        (i % 2 ? namespace.throwIn.setImmediate : namespace.rejectIn.thenCallback)(i),
      );
      await until(() => reports.length === 30);
      expect(reports.toSorted(([a], [b]) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => [i, i]));
    });

    test.concurrent(
      "a graph without onError on the inside is process-wide even inside another graph's timer",
      async () => {
        using dir = tempDir("module-graph-errors-silent-inner", {
          ...files,
          "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const loud = await new ModuleGraph({ onError: onError("loud") }).import(file);
          const silent = await new ModuleGraph().import(file);
          await reported(() => loud.callInTimer(() => silent.throwNow("silent inside loud's timer")));
          await reported(() => loud.callInTimer(() => silent.rejectIn.promiseReject("silent rejects inside loud's timer")));
          await reported(() => silent.callInTimer(() => loud.throwNow("loud inside silent's timer")));
          await reported(() => silent.callInTimer(() => loud.rejectIn.promiseReject("loud rejects inside silent's timer")));
          console.log(JSON.stringify(log, null, 2));
        `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual([
          "process uncaughtException: string silent inside loud's timer",
          "process unhandledRejection: string silent rejects inside loud's timer",
          "loud.onError: string loud inside silent's timer",
          "loud.onError: string loud rejects inside silent's timer",
        ]);
        expect(exitCode).toBe(0);
      },
    );
  });

  describe("process-wide", () => {
    test.concurrent("host errors while graphs exist", async () => {
      using dir = tempDir("module-graph-errors-host", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const graph = await new ModuleGraph({ onError: onError("graph") }).import(file);
          const host = await import(file);
          await reported(() => host.throwIn.setTimeout(new Error("host timer")));
          await reported(() => host.throwIn.nextTick(new Error("host nextTick")));
          await reported(() => host.rejectIn.asyncFunction(new Error("host async function")));
          await reported(() => host.rejectIn.promiseReject("host string"));
          await reported(() => { Promise.reject(new Error("main module")); });
          // The graph's namespace object is reachable, its code is not on the stack.
          await reported(() => { setTimeout(() => { graph.create; throw new Error("host timer touching the graph"); }, 0); });
          await reported(() => graph.throwIn.setTimeout(new Error("the graph still gets its own")));
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "process uncaughtException: host timer",
        "process uncaughtException: host nextTick",
        "process unhandledRejection: host async function",
        "process unhandledRejection: string host string",
        "process unhandledRejection: main module",
        "process uncaughtException: host timer touching the graph",
        "graph.onError: the graph still gets its own",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a graph without onError", async () => {
      using dir = tempDir("module-graph-errors-without", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const other = await new ModuleGraph({ onError: onError("other") }).import(file);
          const silent = await new ModuleGraph({ onError: undefined }).import(file);
          await reported(() => silent.throwIn.setTimeout(new Error("timer")));
          await reported(() => silent.throwIn.queueMicrotask("microtask"));
          await reported(() => silent.rejectIn.asyncFunction(new Error("async function")));
          await reported(() => silent.rejectIn.tailCallOfOwnError("tail call"));
          await reported(() => silent.listeners.target(new Error("listener")).dispatchEvent(new Event("fault")));
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "process uncaughtException: timer",
        "process uncaughtException: string microtask",
        "process unhandledRejection: async function",
        "process unhandledRejection: tail call",
        "process uncaughtException: listener",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("what onError throws, once, and never to a graph", async () => {
      using dir = tempDir("module-graph-errors-throwing-handler", {
        "faults.mjs": faults,
        "handler.mjs": `
          export const throwingHandler = error => { record("handler saw " + error.message); throw new Error("thrown by " + name + "'s code as onError: " + error.message); };
        `,
        "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const record = message => log.push(message);
          let fail = true;
          const flaky = await new ModuleGraph({
            onError(error) {
              onError("flaky")(error);
              if (fail) throw new Error("thrown by onError: " + show(error));
            },
          }).import(file);
          const bystander = await new ModuleGraph({ onError: onError("bystander") }).import(file);
          // onError implemented by another graph's code: what it throws is not that graph's error either.
          const handlers = await new ModuleGraph({ globals: { record, name: "handlers" }, onError: onError("handlers") }).import(import.meta.dir + "/handler.mjs");
          const delegating = await new ModuleGraph({ onError: handlers.throwingHandler }).import(file);

          await reported(() => flaky.throwIn.setTimeout(new Error("exception")), 2);
          await reported(() => flaky.rejectIn.promiseReject(new Error("rejection")), 2);
          await reported(() => flaky.throwIn.setTimeout("a string"), 2);
          await reported(() => delegating.throwIn.setTimeout(new Error("delegated")), 2);
          fail = false;
          await reported(() => flaky.throwIn.setTimeout(new Error("after onError threw")));
          await reported(() => bystander.throwIn.setTimeout(new Error("bystander")));
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "flaky.onError: exception",
        "process uncaughtException: thrown by onError: exception",
        "flaky.onError: rejection",
        "process uncaughtException: thrown by onError: rejection",
        "flaky.onError: string a string",
        "process uncaughtException: thrown by onError: string a string",
        "handler saw delegated",
        "process uncaughtException: thrown by handlers's code as onError: delegated",
        "flaky.onError: after onError threw",
        "bystander.onError: bystander",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("an exception reported while onError runs, and an onError that cannot be called", async () => {
      using dir = tempDir("module-graph-errors-during-handler", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          process.on("uncaughtExceptionMonitor", error => log.push("process uncaughtExceptionMonitor: " + show(error)));
          const file = import.meta.dir + "/faults.mjs";
          let target;
          const dispatching = await new ModuleGraph({
            onError(error) {
              onError("dispatching")(error);
              // dispatchEvent() does not throw; the listener's exception is reported from inside onError.
              target.dispatchEvent(new Event("fault"));
            },
          }).import(file);
          target = dispatching.listeners.target(new Error("thrown by the graph's listener during onError"));
          await reported(() => dispatching.throwIn.setTimeout(new Error("first")), 3);

          const constructorAsHandler = await new ModuleGraph({ onError: class { constructor() { log.push("constructed"); } } }).import(file);
          await reported(() => constructorAsHandler.throwIn.setTimeout(new Error("never seen")), 2);
          console.log(JSON.stringify(log.map(line => line.replace(/class constructor.*/, "class constructor")), null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "dispatching.onError: first",
        "process uncaughtExceptionMonitor: thrown by the graph's listener during onError",
        "process uncaughtException: thrown by the graph's listener during onError",
        "process uncaughtExceptionMonitor: Cannot call a class constructor",
        "process uncaughtException: Cannot call a class constructor",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a rejected promise from the host's onError is the host's rejection", async () => {
      using dir = tempDir("module-graph-errors-rejecting-handler", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const asyncHandler = await new ModuleGraph({
            async onError(error) {
              onError("async")(error);
              throw new Error("thrown by async onError: " + error.message);
            },
          }).import(file);
          const asyncHandlerAfterAwait = await new ModuleGraph({
            async onError(error) {
              onError("async after await")(error);
              await null;
              throw new Error("thrown by async onError after await: " + error.message);
            },
          }).import(file);
          const returnsRejected = await new ModuleGraph({
            onError(error) {
              onError("returns rejected")(error);
              return Promise.reject("rejected by onError: " + error.message);
            },
          }).import(file);

          await reported(() => asyncHandler.throwIn.setTimeout(new Error("exception")), 2);
          await reported(() => asyncHandler.rejectIn.asyncFunction(new Error("rejection")), 2);
          await reported(() => asyncHandlerAfterAwait.throwIn.setTimeout(new Error("exception")), 2);
          await reported(() => returnsRejected.rejectIn.promiseReject(new Error("rejection")), 2);
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "async.onError: exception",
        "process unhandledRejection: thrown by async onError: exception",
        "async.onError: rejection",
        "process unhandledRejection: thrown by async onError: rejection",
        "async after await.onError: exception",
        "process unhandledRejection: thrown by async onError after await: exception",
        "returns rejected.onError: rejection",
        "process unhandledRejection: string rejected by onError: rejection",
      ]);
      expect(exitCode).toBe(0);
    });

    // An onError implemented by the graph's own code: the promise it rejects while it runs is what
    // "onError itself throws", so it must not come back to onError.
    test.concurrent.each(["asyncFunction", "promiseReject"])(
      "a rejection made by the graph's own code while it runs as onError (%s) is not re-delivered",
      async source => {
        using dir = tempDir("module-graph-errors-own-handler", {
          "faults.mjs": faults,
          "main.mjs": `
            ${prelude}
            let deliveries = 0;
            let namespace;
            const graph = new ModuleGraph({
              onError(error) {
                onError("graph")(error);
                // Give up instead of spinning forever when every rejection comes back here.
                if (++deliveries === 5) {
                  console.log(JSON.stringify(log, null, 2));
                  process.exit(0);
                }
                namespace.rejectIn[process.argv[2]](new Error("rejected inside onError"));
              },
            });
            namespace = await graph.import(import.meta.dir + "/faults.mjs");
            await reported(() => namespace.throwIn.setTimeout(new Error("first")), 2);
            console.log(JSON.stringify(log, null, 2));
          `,
        });
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs", source]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual([
          "graph.onError: first",
          "process unhandledRejection: rejected inside onError",
        ]);
        expect(exitCode).toBe(0);
      },
    );
  });

  describe("handled rejections", () => {
    test("handled before the microtask checkpoint: never reported", async () => {
      using dir = tempDir("module-graph-errors-handled-early", {
        "faults.mjs": faults,
        "handles.mjs": `
          export const rejectAndCatch = error => { Promise.reject(error).catch(() => {}); };
          export const rejectAndCatchInMicrotask = error => { const promise = Promise.reject(error); queueMicrotask(() => { promise.catch(() => {}); }); };
          export const rejectAndAwait = async error => { try { await Promise.reject(error); } catch {} };
          export const rejectAndThenWithHandler = error => { (async () => { throw error; })().then(undefined, () => {}); };
        `,
      });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const handles = await graph.import(join(String(dir), "handles.mjs"));
      const { rejected, throwIn } = await graph.import(join(String(dir), "faults.mjs"));

      handles.rejectAndCatch(new Error("caught by the graph"));
      handles.rejectAndCatchInMicrotask(new Error("caught by the graph in a microtask"));
      await handles.rejectAndAwait(new Error("awaited by the graph"));
      handles.rejectAndThenWithHandler(new Error("then(undefined, handler)"));
      rejected(new Error("caught by the host")).promise.catch(() => {});

      const last = new Error("the only report");
      throwIn.setTimeout(last);
      await until(() => errors.length > 0);
      expect(errors).toEqual([last]);
    });

    test.concurrent("handled after delivery to onError: no rejectionHandled", async () => {
      using dir = tempDir("module-graph-errors-handled-late", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const graph = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/faults.mjs");
          let promise;
          await reported(() => { ({ promise } = graph.rejected(new Error("handled late"))); });
          const handled = [];
          promise.catch(error => handled.push(error.message));
          let tail;
          await reported(() => { tail = graph.rejectIn.tailCallOfOwnError("handled late, tail call"); });
          tail.catch(error => handled.push(error.message));
          // A host rejection handled late is reported after the two above would have been.
          await reported(() => { promise = Promise.reject(new Error("host, handled late")); });
          await reported(() => { promise.catch(error => handled.push(error.message)); });
          console.log(JSON.stringify({ log, handled }, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        log: [
          "graph.onError: handled late",
          "graph.onError: handled late, tail call",
          "process unhandledRejection: host, handled late",
          "process rejectionHandled",
        ],
        handled: ["handled late", "handled late, tail call", "host, handled late"],
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("a graph without onError, handled late: unhandledRejection then rejectionHandled", async () => {
      using dir = tempDir("module-graph-errors-handled-late-silent", {
        "faults.mjs": faults,
        "main.mjs": `
          ${prelude}
          const file = import.meta.dir + "/faults.mjs";
          const other = await new ModuleGraph({ onError: onError("other") }).import(file);
          const silent = await new ModuleGraph().import(file);
          const promises = [];
          process.on("rejectionHandled", promise => log.push("it is the rejected promise: " + (promise === promises[0])));
          await reported(() => { promises.push(silent.rejected(new Error("silent, handled late")).promise); });
          await reported(() => { promises[0].catch(() => {}); }, 2);
          console.log(JSON.stringify(log, null, 2));
        `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "process unhandledRejection: silent, handled late",
        "process rejectionHandled",
        "it is the rejected promise: true",
      ]);
      expect(exitCode).toBe(0);
    });

    test("a rejection delivered to onError is delivered once, however many times it is handled later", async () => {
      using dir = tempDir("module-graph-errors-once", { "faults.mjs": faults });
      const errors: unknown[] = [];
      using graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { rejected, throwIn } = await graph.import(join(String(dir), "faults.mjs"));

      const first = new Error("delivered once");
      const { promise } = rejected(first);
      await until(() => errors.length === 1);
      const handled: unknown[] = [];
      promise.catch((error: unknown) => handled.push(error));
      promise.then(undefined, (error: unknown) => handled.push(error));
      await promise.catch(() => {});
      // A derived promise nobody handles is the host's: \`promise.then()\` was called here.
      const last = new Error("the last report");
      throwIn.setTimeout(last);
      await until(() => errors.length === 2);
      expect({ errors, handled }).toEqual({ errors: [first, last], handled: [first, first] });
    });
  });

  describe("--unhandled-rejections", () => {
    const files = {
      "faults.mjs": faults,
      "main.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const log = [];
        const graph = await new ModuleGraph({ onError: error => log.push("graph.onError: " + error.message) }).import(import.meta.dir + "/faults.mjs");
        if (process.argv[2] === "graph") {
          graph.rejectIn.promiseReject(new Error("rejected by the graph"));
          graph.rejectIn.asyncFunction(new Error("thrown by the graph's async function"));
          while (log.length < 2) await new Promise(resolve => setImmediate(resolve));
        } else {
          Promise.reject(new Error("rejected by the host"));
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log(JSON.stringify(log));
      `,
    };
    const modes = [
      { mode: "default", args: [], hostExitCode: 1, hostPrints: true },
      { mode: "strict", args: ["--unhandled-rejections=strict"], hostExitCode: 1, hostPrints: true },
      { mode: "throw", args: ["--unhandled-rejections=throw"], hostExitCode: 1, hostPrints: true },
      { mode: "warn", args: ["--unhandled-rejections=warn"], hostExitCode: 0, hostPrints: true },
      {
        mode: "warn-with-error-code",
        args: ["--unhandled-rejections=warn-with-error-code"],
        hostExitCode: 1,
        hostPrints: true,
      },
      { mode: "none", args: ["--unhandled-rejections=none"], hostExitCode: 0, hostPrints: false },
    ];

    test.concurrent.each(modes)("$mode: the graph's rejection goes to onError", async ({ args }) => {
      using dir = tempDir("module-graph-errors-mode-graph", files);
      const { stdout, stderr, exitCode } = await run(String(dir), [...args, "main.mjs", "graph"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: rejected by the graph",
        "graph.onError: thrown by the graph's async function",
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent.each(modes)(
      "$mode: the host's rejection is unchanged",
      async ({ args, hostExitCode, hostPrints }) => {
        using dir = tempDir("module-graph-errors-mode-host", files);
        const { stdout, stderr, exitCode } = await run(String(dir), [...args, "main.mjs", "host"]);
        expect(stderr.includes("rejected by the host")).toBe(hostPrints);
        expect(stdout).not.toContain("graph.onError");
        expect(exitCode).toBe(hostExitCode);
      },
    );
  });

  describe("the default fatal path", () => {
    const files = {
      "faults.mjs": faults,
      "main.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const file = import.meta.dir + "/faults.mjs";
        const seen = [];
        const graph = await new ModuleGraph({
          onError(error) {
            seen.push(error.message);
            if (process.argv[2] === "onError throws") throw new Error("thrown by onError");
          },
        }).import(file);
        const silent = await new ModuleGraph().import(file);
        const host = await import(file);
        process.on("exit", () => console.log(JSON.stringify(seen)));
        switch (process.argv[2]) {
          case "host exception": host.throwIn.setImmediate(new Error("fatal: host exception")); break;
          case "host rejection": host.rejectIn.asyncFunction(new Error("fatal: host rejection")); break;
          case "graph without onError exception": silent.throwIn.setImmediate(new Error("fatal: silent exception")); break;
          case "graph without onError rejection": silent.rejectIn.asyncFunction(new Error("fatal: silent rejection")); break;
          case "onError throws": graph.throwIn.setImmediate(new Error("taken by onError")); break;
          case "graph exception": graph.throwIn.setImmediate(new Error("taken by onError")); break;
          case "graph rejection": graph.rejectIn.asyncFunction(new Error("taken by onError")); break;
        }
        // The fault is reported (or ends the process) before an immediate queued after it runs.
        await new Promise(resolve => setImmediate(resolve));
      `,
    };

    test.concurrent.each([
      ["host exception", "fatal: host exception"],
      ["host rejection", "fatal: host rejection"],
      ["graph without onError exception", "fatal: silent exception"],
      ["graph without onError rejection", "fatal: silent rejection"],
    ])("%s: printed, exit code 1", async (scenario, message) => {
      using dir = tempDir("module-graph-errors-fatal", files);
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs", scenario]);
      expect(stderr).toContain(message);
      expect(JSON.parse(stdout)).toEqual([]);
      expect(exitCode).toBe(1);
    });

    test.concurrent("onError throws: printed, exit code 1", async () => {
      using dir = tempDir("module-graph-errors-fatal-handler", files);
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs", "onError throws"]);
      expect(stderr).toContain("thrown by onError");
      expect(stderr).not.toContain("taken by onError");
      expect(JSON.parse(stdout)).toEqual(["taken by onError"]);
      expect(exitCode).toBe(1);
    });

    test.concurrent.each(["graph exception", "graph rejection"])(
      "%s with onError: nothing printed, exit code 0",
      async scenario => {
        using dir = tempDir("module-graph-errors-not-fatal", files);
        const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs", scenario]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(["taken by onError"]);
        expect(exitCode).toBe(0);
      },
    );
  });

  describe("the onError call", () => {
    test("`this` is undefined and the error is the only argument", async () => {
      using dir = tempDir("module-graph-errors-call-shape", { "faults.mjs": faults });
      const calls: unknown[] = [];
      using graph = new ModuleGraph({
        onError: function (this: unknown) {
          "use strict";
          calls.push({ this: this, arguments: [...arguments] });
        },
      });
      const { throwIn, rejectIn } = await graph.import(join(String(dir), "faults.mjs"));

      const thrown = new Error("thrown");
      const rejected = new Error("rejected");
      throwIn.setTimeout(thrown);
      await until(() => calls.length === 1);
      rejectIn.promiseReject(rejected);
      await until(() => calls.length === 2);
      expect(calls).toEqual([
        { this: undefined, arguments: [thrown] },
        { this: undefined, arguments: [rejected] },
      ]);
    });

    test("onError is read once, at construction", async () => {
      using dir = tempDir("module-graph-errors-read-once", { "faults.mjs": faults });
      const errors: unknown[] = [];
      let reads = 0;
      const options = {
        get onError() {
          reads++;
          return (error: unknown) => errors.push(error);
        },
      };
      using graph = new ModuleGraph(options);
      const { throwIn } = await graph.import(join(String(dir), "faults.mjs"));
      graph.onError = () => errors.push("a property set on the ModuleGraph object");

      throwIn.setTimeout("first");
      await until(() => errors.length === 1);
      throwIn.setTimeout("second");
      await until(() => errors.length === 2);
      expect({ errors, reads }).toEqual({ errors: ["first", "second"], reads: 1 });
    });

    test("onError may be any callable", async () => {
      using dir = tempDir("module-graph-errors-callables", { "faults.mjs": faults });
      const file = join(String(dir), "faults.mjs");
      const seen: unknown[] = [];
      const record = (...args: unknown[]) => seen.push(args);
      using proxied = new ModuleGraph({ onError: new Proxy(record, {}) });
      using bound = new ModuleGraph({ onError: record.bind(null, "bound") });
      using native = new ModuleGraph({ onError: Array.prototype.push.bind(seen) });

      (await proxied.import(file)).throwIn.setTimeout("to the Proxy");
      await until(() => seen.length === 1);
      (await bound.import(file)).throwIn.setTimeout("to the bound function");
      await until(() => seen.length === 2);
      (await native.import(file)).throwIn.setTimeout("to the native function");
      await until(() => seen.length === 3);
      expect(seen).toEqual([["to the Proxy"], ["bound", "to the bound function"], "to the native function"]);
    });

    test.each([[null], ["onError"], [{}], [Symbol("onError")], [0], [false]])("onError: %p is not accepted", value => {
      expect(() => new ModuleGraph({ onError: value })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    });

    test("after dispose()", async () => {
      using dir = tempDir("module-graph-errors-disposed", { "faults.mjs": faults });
      const errors: unknown[] = [];
      const graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { throwIn, rejectIn } = await graph.import(join(String(dir), "faults.mjs"));
      graph.dispose();

      throwIn.setTimeout("exception after dispose()");
      await until(() => errors.length === 1);
      rejectIn.asyncFunction("rejection after dispose()");
      await until(() => errors.length === 2);
      rejectIn.tailCallOfOwnError("tail call after dispose()");
      await until(() => errors.length === 3);
      expect(errors).toEqual([
        "exception after dispose()",
        "rejection after dispose()",
        expect.objectContaining({ message: "tail call after dispose()" }),
      ]);
    });

    test("an error pending when dispose() is called", async () => {
      using dir = tempDir("module-graph-errors-dispose-pending", { "faults.mjs": faults });
      const errors: unknown[] = [];
      const graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
      const { throwIn, rejectIn } = await graph.import(join(String(dir), "faults.mjs"));

      rejectIn.promiseReject("rejected before dispose()");
      throwIn.setTimeout("scheduled before dispose()");
      graph.dispose();
      await until(() => errors.length === 2);
      expect(errors).toEqual(["rejected before dispose()", "scheduled before dispose()"]);
    });

    test("after the ModuleGraph object was collected", async () => {
      using dir = tempDir("module-graph-errors-collected", { "faults.mjs": faults });
      const file = join(String(dir), "faults.mjs");
      const errors: unknown[] = [];
      async function load() {
        const graph = new ModuleGraph({ onError: (error: unknown) => errors.push(error) });
        const { rejectIn, create } = await graph.import(file);
        return { rejectIn, create };
      }
      const { rejectIn, create } = await load();
      Bun.gc(true);

      rejectIn.asyncFunction("rejection");
      await until(() => errors.length === 1);
      Bun.gc(true);
      rejectIn.tailCallOfOwnError("tail call");
      await until(() => errors.length === 2);
      Bun.gc(true);
      Promise.reject(create.error("created by the collected graph's code"));
      await until(() => errors.length === 3);
      expect(errors).toEqual([
        "rejection",
        expect.objectContaining({ message: "tail call" }),
        expect.objectContaining({ message: "created by the collected graph's code" }),
      ]);
    });

    test("onError can create graphs, import into its graph and dispose it", async () => {
      using dir = tempDir("module-graph-errors-reentrant", {
        "faults.mjs": faults,
        "loaded-by-on-error.mjs": `export const loaded = true;`,
      });
      const file = join(String(dir), "faults.mjs");
      const errors: unknown[] = [];
      const work: Promise<unknown>[] = [];
      const graph = new ModuleGraph({
        onError(error: unknown) {
          errors.push(error);
          if (errors.length > 1) return;
          Bun.gc(true);
          work.push(graph.import(join(String(dir), "loaded-by-on-error.mjs")));
          const nested = new ModuleGraph({ onError: (error: unknown) => errors.push(["nested", error]) });
          work.push(
            nested
              .import(file)
              .then((namespace: any) => namespace.throwIn.setTimeout("from the graph onError created")),
          );
          graph.dispose();
          work.push(graph.import(file).catch((error: any) => error.code));
        },
      });
      const { throwIn } = await graph.import(file);

      throwIn.setTimeout("first");
      await until(() => errors.length === 2);
      throwIn.setTimeout("after onError disposed the graph");
      await until(() => errors.length === 3);
      expect(errors).toEqual([
        "first",
        ["nested", "from the graph onError created"],
        "after onError disposed the graph",
      ]);
      expect(await Promise.all(work)).toEqual([
        expect.objectContaining({ loaded: true }),
        undefined,
        "ERR_INVALID_STATE",
      ]);
    });

    test("an error the graph's code raises while onError runs is a new report", async () => {
      using dir = tempDir("module-graph-errors-nested-report", { "faults.mjs": faults });
      const errors: unknown[] = [];
      let namespace: any;
      using graph = new ModuleGraph({
        onError(error: unknown) {
          errors.push(error);
          if (error === "first") namespace.throwIn.setTimeout("scheduled by onError");
        },
      });
      namespace = await graph.import(join(String(dir), "faults.mjs"));

      namespace.throwIn.setTimeout("first");
      await until(() => errors.length === 2);
      expect(errors).toEqual(["first", "scheduled by onError"]);
    });
  });

  test.concurrent(
    "code from node:vm, new Function and eval belongs to the graph only under the graph's frames",
    async () => {
      using dir = tempDir("module-graph-errors-vm", {
        "evaluates.mjs": `
        import vm from "node:vm";
        const message = "direct eval closure in a timer";
        export const make = {
          vmFunction: () => vm.runInThisContext("(act) => { act(); }"),
          newFunction: () => new Function("act", "act();"),
          indirectEval: () => (0, eval)("(act) => { act(); }"),
        };
        export const throwInTimerFromDirectEval = () => { eval("setTimeout(() => { throw new Error(message); }, 0);"); };
        export const callInTimer = (fn, ...args) => { setTimeout(() => { fn(...args); }, 0); };
        export const throwNow = message => { throw new Error(message); };
      `,
        "main.mjs": `
        ${prelude}
        const graph = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/evaluates.mjs");
        for (const kind of ["vmFunction", "newFunction", "indirectEval"]) {
          const evaluated = graph.make[kind]();
          // The graph's timer callback calls it: the graph's frame is below it.
          await reported(() => graph.callInTimer(evaluated, () => { throw new Error(kind + " under the graph's timer"); }));
          // It calls the graph's function: the graph's frame is above it.
          await reported(() => { setTimeout(() => evaluated(() => graph.throwNow(kind + " calling the graph")), 0); });
          // No module code on the stack at all: it has no module scope, so it is nobody's.
          await reported(() => { setTimeout(() => evaluated(() => { throw new Error(kind + " in the host's timer"); }), 0); });
        }
        await reported(() => graph.throwInTimerFromDirectEval());
        console.log(JSON.stringify(log, null, 2));
      `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        "graph.onError: vmFunction under the graph's timer",
        "graph.onError: vmFunction calling the graph",
        "process uncaughtException: vmFunction in the host's timer",
        "graph.onError: newFunction under the graph's timer",
        "graph.onError: newFunction calling the graph",
        "process uncaughtException: newFunction in the host's timer",
        "graph.onError: indirectEval under the graph's timer",
        "graph.onError: indirectEval calling the graph",
        "process uncaughtException: indirectEval in the host's timer",
        "graph.onError: direct eval closure in a timer",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("Error.stackTraceLimit and Error.prepareStackTrace", async () => {
    using dir = tempDir("module-graph-errors-stack-api", {
      "faults.mjs": faults,
      "main.mjs": `
        ${prelude}
        const { throwIn, rejectIn, throwOwnErrorIn } = await new ModuleGraph({ onError: onError("graph") }).import(import.meta.dir + "/faults.mjs");
        Error.prepareStackTrace = () => "prepared";
        await reported(() => throwIn.setTimeout("prepareStackTrace: thrown"));
        await reported(() => { rejectIn.tailCallOfOwnError("prepareStackTrace: tail call of own Error"); });
        Error.prepareStackTrace = undefined;
        Error.stackTraceLimit = 0;
        await reported(() => throwIn.setTimeout("stackTraceLimit 0: thrown"));
        await reported(() => rejectIn.promiseReject("stackTraceLimit 0: rejected"));
        await reported(() => rejectIn.afterAwait("stackTraceLimit 0: thrown after await"));
        // The Error captured no frames, so where it was created is unknown.
        await reported(() => { rejectIn.tailCallOfOwnError("stackTraceLimit 0: tail call of own Error"); });
        console.log(JSON.stringify(log, null, 2));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["main.mjs"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      "graph.onError: string prepareStackTrace: thrown",
      "graph.onError: prepareStackTrace: tail call of own Error",
      "graph.onError: string stackTraceLimit 0: thrown",
      "graph.onError: string stackTraceLimit 0: rejected",
      "graph.onError: string stackTraceLimit 0: thrown after await",
      "process unhandledRejection: stackTraceLimit 0: tail call of own Error",
    ]);
    expect(exitCode).toBe(0);
  });

  describe("in a Worker", () => {
    const files = {
      "faults.mjs": faults,
      "worker.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const errors = [];
        const withOnError = await new ModuleGraph({ onError: error => errors.push(error.message) }).import(import.meta.dir + "/faults.mjs");
        withOnError.throwIn.setTimeout(new Error("worker graph exception"));
        withOnError.rejectIn.asyncFunction(new Error("worker graph rejection"));
        while (errors.length < 2) await new Promise(resolve => setImmediate(resolve));
        postMessage(errors.sort());
        self.onmessage = async () => {
          const silent = await new ModuleGraph().import(import.meta.dir + "/faults.mjs");
          silent.throwIn.setTimeout(new Error("worker graph without onError"));
        };
      `,
    };

    test("the worker's graph reports to its onError, not to the parent", async () => {
      using dir = tempDir("module-graph-errors-worker", files);
      const worker = new Worker(join(String(dir), "worker.mjs"));
      const events: string[] = [];
      const message = Promise.withResolvers<string[]>();
      const errorEvent = Promise.withResolvers<void>();
      worker.addEventListener("message", event => message.resolve(event.data));
      worker.addEventListener("error", event => {
        events.push(event.message);
        errorEvent.resolve();
      });

      try {
        expect(await message.promise).toEqual(["worker graph exception", "worker graph rejection"]);
        expect(events).toEqual([]);
        // Without onError the same fault is the worker's uncaught exception.
        worker.postMessage("now without onError");
        await errorEvent.promise;
        expect(events).toEqual([expect.stringContaining("worker graph without onError")]);
      } finally {
        await worker.terminate();
      }
    });
  });

  describe("in bun test", () => {
    const files = {
      "fault.mjs": `
        export const throwInTimer = (message, thrown) => { setTimeout(() => { thrown(); throw new Error(message); }, 0); };
        export const rejectInTimer = (message, rejected) => { setTimeout(() => { rejected(); Promise.reject(new Error(message)); }, 0); };
      `,
      "graph.test.mjs": `
        import { expect, test } from "bun:test";
        const { ModuleGraph } = Bun.unsafe;
        const errors = [];
        const options = process.env.MODULE_GRAPH_ON_ERROR === "1" ? { onError: error => errors.push(error.message) } : {};

        test("the graph throws in a timer", async () => {
          const { throwInTimer } = await new ModuleGraph(options).import(import.meta.dir + "/fault.mjs");
          const { promise, resolve } = Promise.withResolvers();
          throwInTimer("exception from the graph", resolve);
          await promise;
        });
        test("the graph rejects in a timer", async () => {
          const { rejectInTimer } = await new ModuleGraph(options).import(import.meta.dir + "/fault.mjs");
          const { promise, resolve } = Promise.withResolvers();
          rejectInTimer("rejection from the graph", resolve);
          await promise;
          await new Promise(resolve => setImmediate(resolve));
        });
        test("what onError saw", () => {
          expect(errors).toEqual(process.env.MODULE_GRAPH_ON_ERROR === "1" ? ["exception from the graph", "rejection from the graph"] : []);
        });
      `,
    };

    test.concurrent("without onError the graph's error fails the running test", async () => {
      using dir = tempDir("module-graph-errors-bun-test-fails", files);
      const { stderr, exitCode } = await run(String(dir), ["test", "./graph.test.mjs"], { MODULE_GRAPH_ON_ERROR: "0" });
      expect(stderr).toContain("exception from the graph");
      expect(stderr).toContain("rejection from the graph");
      expect(stderr).toContain(" 1 pass");
      expect(stderr).toContain(" 2 fail");
      expect(exitCode).toBe(1);
    });

    test.concurrent("with onError it does not", async () => {
      using dir = tempDir("module-graph-errors-bun-test-passes", files);
      const { stderr, exitCode } = await run(String(dir), ["test", "./graph.test.mjs"], { MODULE_GRAPH_ON_ERROR: "1" });
      expect(stderr).not.toContain("from the graph");
      expect(stderr).toContain(" 3 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });
  });
});
