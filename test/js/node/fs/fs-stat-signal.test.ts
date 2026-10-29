/**
 * `options` and `options.signal` in the async stat family: fsPromises.stat,
 * fsPromises.lstat, filehandle.stat, and the callback forms fs.stat, fs.lstat
 * and fs.fstat. Node added the signal in v26.8.0 (nodejs/node#63143):
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/promises.js#L1855-L1921
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L380-L406
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * Node.js, which is where the expected values come from. The last case runs it
 * there. It cannot import "harness" at the top for the same reason, so it
 * manages its own temporary directory.
 *
 * Where Bun differs from Node.js, the case says so: `expectFailure` marks what
 * Bun does not do yet, and a case that only one runtime can pass is skipped in
 * the other with the reason.
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { getEventListeners } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import util from "node:util";

const isBun = typeof Bun !== "undefined";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-stat-signal-"));
const file = path.join(dir, "f.txt");
const missing = path.join(dir, "missing");
const link = path.join(dir, "link");
const dangling = path.join(dir, "dangling");
fs.writeFileSync(file, "x");
let canLink = true;
try {
  fs.symlinkSync(file, link);
  fs.symlinkSync(missing, dangling);
} catch {
  // Windows without the privilege to create a symbolic link.
  canLink = false;
}
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function abortError(reason: unknown) {
  return (err: any) => {
    assert.deepStrictEqual(
      { name: err.name, code: err.code, message: err.message, cause: err.cause },
      { name: "AbortError", code: "ABORT_ERR", message: "The operation was aborted", cause: reason },
    );
    return true;
  };
}
const notObjects: [unknown, string][] = [
  ["x", "type string ('x')"],
  [1, "type number (1)"],
  [true, "type boolean (true)"],
  [null, "null"],
  [[], "an instance of Array"],
  [() => {}, "function "],
  [1n, "type bigint (1n)"],
  [Symbol("s"), "type symbol (Symbol(s))"],
];
const optionsTypeError = (received: string) => ({
  name: "TypeError",
  code: "ERR_INVALID_ARG_TYPE",
  message: `The "options" argument must be of type object. Received ${received}`,
});
const notSignals: [unknown, string][] = [
  ["nope", "type string ('nope')"],
  [null, "null"],
  [1, "type number (1)"],
  [{}, "an instance of Object"],
];
// Node says "must be an instance of AbortSignal", Bun's shared validator "must be of type AbortSignal".
const signalTypeError = (received: string) => ({
  name: "TypeError",
  code: "ERR_INVALID_ARG_TYPE",
  message: new RegExp(
    `^The "options\\.signal" property must be (an instance of|of type) AbortSignal\\. Received ${received.replace(/[()']/g, "\\$&")}$`,
  ),
});
const callbackTypeError = {
  name: "TypeError",
  code: "ERR_INVALID_ARG_TYPE",
  message: `The "cb" argument must be of type function. Received type string ('not a function')`,
};
// Node names the argument and the types. Bun's native check says "path must be a string or TypedArray".
const pathTypeError = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" };
// What `signal.addEventListener(...)` throws when the signal has no such method.
const uncodedTypeError = (err: any) => {
  assert.deepStrictEqual([err.name, err.code], ["TypeError", undefined]);
  return true;
};
const listeners = (signal: AbortSignal) => getEventListeners(signal, "abort").length;

// A stat completes on a later turn of the event loop, so a promise that settles
// while only microtasks run was settled by abort().
async function settlesWithoutTheEventLoop(promise: Promise<unknown>) {
  let settled = false;
  const mark = () => void (settled = true);
  promise.then(mark, mark);
  for (let i = 0; i < 50 && !settled; i++) await null;
  return settled;
}

// Resolves when the stat behind a call has completed and released its listener.
function untilListeners(signal: AbortSignal, count: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  (function poll() {
    if (listeners(signal) === count) resolve();
    else setImmediate(poll);
  })();
  return promise;
}

// Stats made one after another, each started when the one before it completed. A stat that an earlier
// call left running completes in this time, and so does its rejection when nothing handles it.
async function laterStats() {
  for (let i = 0; i < 8; i++) {
    const { promise, resolve } = Promise.withResolvers();
    fs.stat(missing, resolve);
    await promise;
  }
}

type PromiseForm = { call: (target: any, ...rest: any[]) => Promise<any>; usesPath: boolean };
const promiseForms: Record<string, PromiseForm> = {
  "fsPromises.stat": { call: (target, ...rest) => fsp.stat(target, ...rest), usesPath: true },
  "fsPromises.lstat": { call: (target, ...rest) => fsp.lstat(target, ...rest), usesPath: true },
  "filehandle.stat": { call: (handle, ...rest) => handle.stat(...rest), usesPath: false },
};

for (const [name, form] of Object.entries(promiseForms)) {
  describe(name, () => {
    let handle: fsp.FileHandle;
    let target: any;
    before(async () => {
      handle = await fsp.open(file, "r");
      target = form.usesPath ? file : handle;
    });
    after(() => handle.close());

    test("rejects an options value that is not an object", async () => {
      for (const [options, received] of notObjects) {
        await assert.rejects(form.call(target, options), optionsTypeError(received));
      }
    });

    test("accepts undefined and an object of any class", async () => {
      for (const options of [undefined, {}, { signal: undefined }, new Date(), new Map(), { __proto__: null }]) {
        assert.ok((await form.call(target, options)).isFile(), util.inspect(options));
      }
    });

    test("rejects a signal that is not an AbortSignal", async () => {
      for (const [signal, received] of notSignals) {
        await assert.rejects(form.call(target, { signal }), signalTypeError(received));
      }
    });

    test("rejects with an AbortError when the signal is already aborted", async () => {
      const reason = new Error("why");
      await assert.rejects(form.call(target, { signal: AbortSignal.abort(reason) }), abortError(reason));
      const signal = AbortSignal.abort();
      await assert.rejects(form.call(target, { signal }), abortError(signal.reason));
      const any = AbortSignal.any([AbortSignal.abort(reason)]);
      await assert.rejects(form.call(target, { signal: any, bigint: true }), abortError(reason));
    });

    test("abort() after the call rejects at abort time and leaves no listener", async () => {
      const controller = new AbortController();
      const reason = new Error("stop");
      const promise = form.call(target, { signal: controller.signal });
      assert.strictEqual(listeners(controller.signal), 1);
      controller.abort(reason);
      assert.strictEqual(await settlesWithoutTheEventLoop(promise), true);
      await assert.rejects(promise, abortError(reason));
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test("fulfils and leaves no listener when the signal stays live", async () => {
      const controller = new AbortController();
      for (let i = 0; i < 20; i++) {
        assert.ok((await form.call(target, { signal: controller.signal })).isFile());
      }
      assert.strictEqual(listeners(controller.signal), 0);
      assert.strictEqual(typeof (await form.call(target, { signal: controller.signal, bigint: true })).size, "bigint");
      controller.abort();
    });

    test("one signal aborts every call that is pending on it", async () => {
      const controller = new AbortController();
      const pending = Array.from({ length: 5 }, () => form.call(target, { signal: controller.signal }));
      assert.strictEqual(listeners(controller.signal), 5);
      controller.abort("why");
      for (const result of await Promise.allSettled(pending)) {
        assert.strictEqual(result.status, "rejected");
        abortError("why")((result as PromiseRejectedResult).reason);
      }
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test("an earlier listener that stops propagation does not hide the abort", async () => {
      const controller = new AbortController();
      controller.signal.addEventListener("abort", event => event.stopImmediatePropagation());
      const promise = form.call(target, { signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, abortError(controller.signal.reason));
    });

    test("a signal that aborts while the call reads its options rejects with the AbortError", async () => {
      const controller = new AbortController();
      const options = {
        signal: controller.signal,
        get bigint() {
          controller.abort("in the getter");
          return false;
        },
      };
      await assert.rejects(form.call(target, options), abortError("in the getter"));
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test("an object with an `aborted` property counts as a signal", async () => {
      await assert.rejects(form.call(target, { signal: { aborted: true, reason: "r" } }), abortError("r"));
      // Node leaves the stat it started here with no handler. That is safe to run in both only for a stat that cannot fail.
      if (form.usesPath) {
        await assert.rejects(form.call(target, { signal: { aborted: false } }), uncodedTypeError);
      }
    });

    test("name and length", () => {
      const method = name.split(".")[1];
      const fn = form.usesPath ? (fsp as any)[method] : Object.getPrototypeOf(handle).stat;
      assert.deepStrictEqual([fn.name, fn.length], [method, 1]);
    });
  });
}

describe("fsPromises.stat and fsPromises.lstat", () => {
  // `signal` is not in the types of @types/node yet.
  const [stat, lstat] = [fsp.stat, fsp.lstat] as ((path: any, options?: any) => Promise<any>)[];

  for (const fn of [stat, lstat]) {
    test(`${fn.name} checks options, then the signal, then aborted, then the path`, async () => {
      await assert.rejects(fn(123, "x"), optionsTypeError("type string ('x')"));
      await assert.rejects(fn(123, { signal: "nope" }), signalTypeError("type string ('nope')"));
      const signal = AbortSignal.abort();
      await assert.rejects(fn(123, { signal }), abortError(signal.reason));
      await assert.rejects(fn(missing, { signal }), abortError(signal.reason));
      const controller = new AbortController();
      await assert.rejects(fn(123, { signal: controller.signal }), pathTypeError);
      await assert.rejects(fn("a\0b", { signal: controller.signal }), { code: "ERR_INVALID_ARG_VALUE" });
      assert.strictEqual(listeners(controller.signal), 0);
      // The path is checked before anything is asked of the signal.
      await assert.rejects(fn(123, { signal: { aborted: false } }), pathTypeError);
    });

    test(`${fn.name} rejects the index that Array.prototype.map passes as options`, async () => {
      await assert.rejects(Promise.all([file, dir].map(fn)), optionsTypeError("type number (0)"));
    });

    test(`${fn.name} rejects with the error of the stat when the signal stays live`, async () => {
      const controller = new AbortController();
      await assert.rejects(fn(missing, { signal: controller.signal }), { code: "ENOENT", syscall: fn.name });
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test(`${fn.name}: the error of a stat names the function that awaits it, with and without a signal`, async () => {
      async function theCallerOfTheStat(options: unknown) {
        return await fn(missing, options);
      }
      for (const options of [undefined, { signal: new AbortController().signal }]) {
        await assert.rejects(theCallerOfTheStat(options), (err: any) => {
          assert.match(String(err.stack), /theCallerOfTheStat/, util.inspect(options));
          return true;
        });
      }
    });

    test(`${fn.name} drops the result of an aborted stat, also when the stat fails`, async () => {
      const controller = new AbortController();
      const promise = fn(missing, { signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, abortError(controller.signal.reason));
      // The ENOENT arrives after this. If nothing handled it, it would fail this file as an unhandled rejection.
      await laterStats();
    });

    test(
      `${fn.name}: a signal that cannot take a listener leaves no stat without a handler`,
      { skip: !isBun && "Node.js leaves the stat it started with no handler, so its ENOENT is an unhandled rejection" },
      async () => {
        await assert.rejects(fn(missing, { signal: { aborted: false } }), uncodedTypeError);
        await laterStats();
      },
    );

    test(`${fn.name} takes a Buffer and a URL as the path when there is a signal`, async () => {
      const controller = new AbortController();
      for (const target of [Buffer.from(file), pathToFileURL(file)]) {
        assert.ok((await fn(target, { signal: controller.signal })).isFile(), util.inspect(target));
        await assert.rejects(fn(target, { signal: AbortSignal.abort("r") }), abortError("r"));
      }
    });
  }

  test("stat with throwIfNoEntry: false and a live signal fulfils with undefined", async () => {
    const controller = new AbortController();
    assert.strictEqual(await stat(missing, { throwIfNoEntry: false, signal: controller.signal }), undefined);
    assert.strictEqual(listeners(controller.signal), 0);
  });

  test(
    "with a signal, lstat does not follow a link and stat does",
    { skip: !canLink && "cannot create a symbolic link" },
    async () => {
      const { signal } = new AbortController();
      assert.deepStrictEqual(
        [(await lstat(link, { signal })).isSymbolicLink(), (await stat(link, { signal })).isSymbolicLink()],
        [true, false],
      );
      assert.strictEqual((await lstat(dangling, { signal })).isSymbolicLink(), true);
      await assert.rejects(stat(dangling, { signal }), { code: "ENOENT", syscall: "stat" });
      assert.strictEqual(typeof (await lstat(link, { signal, bigint: true })).size, "bigint");
    },
  );
});

describe("FileHandle", () => {
  test("a closed handle reports EBADF before it looks at options", async () => {
    const handle = await fsp.open(file, "r");
    await handle.close();
    await assert.rejects(handle.stat("x" as any), { code: "EBADF", syscall: "fstat" });
    await assert.rejects(handle.stat({ signal: AbortSignal.abort() } as any), { code: "EBADF", syscall: "fstat" });
  });

  test("a rejected stat leaves the handle open", async () => {
    const handle = await fsp.open(file, "r");
    try {
      await assert.rejects(handle.stat("x" as any), optionsTypeError("type string ('x')"));
      await assert.rejects(handle.stat({ signal: AbortSignal.abort() } as any), { name: "AbortError" });
      assert.ok((await handle.stat()).isFile());
      assert.notStrictEqual(handle.fd, -1);
    } finally {
      await handle.close();
    }
  });

  test("an aborted stat releases the handle, so a pending close() completes", async () => {
    const handle = await fsp.open(file, "r");
    const controller = new AbortController();
    const order: string[] = [];
    const stat = handle.stat({ signal: controller.signal } as any).then(
      () => order.push("stat fulfilled"),
      err => order.push(`stat ${err.name}`),
    );
    const close = handle.close().then(() => order.push("close"));
    controller.abort();
    await Promise.all([stat, close]);
    assert.deepStrictEqual(order, ["stat AbortError", "close"]);
    assert.strictEqual(handle.fd, -1);
  });

  test(
    "a signal that cannot take a listener leaves no fstat without a handler when the handle closes",
    { skip: !isBun && "Node.js leaves the fstat it started with no handler, so an EBADF after close() is unhandled" },
    async () => {
      for (let i = 0; i < 5; i++) {
        const handle = await fsp.open(file, "r");
        const stat = assert.rejects(handle.stat({ signal: { aborted: false } } as any), { name: "TypeError" });
        await Promise.all([stat, handle.close()]);
      }
      await laterStats();
    },
  );
});

describe("callback forms", () => {
  let fd: number;
  before(() => void (fd = fs.openSync(file, "r")));
  after(() => fs.closeSync(fd));

  const forms: Record<string, () => string | number> = {
    stat: () => file,
    lstat: () => file,
    fstat: () => fd,
  };

  for (const [name, target] of Object.entries(forms)) {
    const fn = (fs as any)[name] as (target: any, options: any, callback: any) => void;
    const call = (options: any, callback: any) => fn(target(), options, callback);
    const promised = (options: any) => {
      const { promise, resolve, reject } = Promise.withResolvers<fs.Stats>();
      call(options, (err: Error | null, stats: fs.Stats) => (err ? reject(err) : resolve(stats)));
      return promise;
    };
    const failing = () => (name === "fstat" ? 987654 : missing);
    const failingCode = name === "fstat" ? "EBADF" : "ENOENT";

    test(`fs.${name}: an options value that is not an object means no options`, async () => {
      for (const options of ["x", 1, null, undefined, {}, { signal: undefined }]) {
        assert.ok((await promised(options)).isFile(), util.inspect(options));
      }
    });

    test(`fs.${name}: a signal that is not an AbortSignal throws from the call`, () => {
      for (const [signal, received] of notSignals) {
        assert.throws(() => call({ signal }, assert.fail), signalTypeError(received));
      }
    });

    test(`fs.${name}: a signal that is already aborted calls back before the call returns`, async () => {
      const reason = new Error("why");
      const signal = AbortSignal.abort(reason);
      const calls: { args: unknown[]; returned: boolean; self: unknown }[] = [];
      let returned = false;
      call({ signal }, function (this: unknown, ...args: unknown[]) {
        calls.push({ args, returned, self: this });
      });
      returned = true;
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(
        { returned: calls[0].returned, argumentCount: calls[0].args.length, self: calls[0].self },
        { returned: false, argumentCount: 1, self: undefined },
      );
      abortError(reason)(calls[0].args[0]);
      // No stat was started: a stat in flight holds a listener, and calls back within these round trips.
      assert.strictEqual(listeners(signal), 0);
      await laterStats();
      assert.strictEqual(calls.length, 1);
    });

    test(`fs.${name}: a throw from the callback of an aborted signal leaves the call`, () => {
      assert.throws(
        () =>
          call({ signal: AbortSignal.abort() }, () => {
            throw new RangeError("from the callback");
          }),
        { name: "RangeError", message: "from the callback" },
      );
    });

    test(`fs.${name}: abort() after the call runs the callback inside abort(), once`, async () => {
      const controller = new AbortController();
      const reason = new Error("stop");
      const calls: { args: unknown[]; insideAbort: boolean; self: unknown }[] = [];
      let insideAbort = false;
      call({ signal: controller.signal }, function (this: unknown, ...args: unknown[]) {
        calls.push({ args, insideAbort, self: this });
      });
      assert.strictEqual(listeners(controller.signal), 1);
      insideAbort = true;
      controller.abort(reason);
      insideAbort = false;
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(
        { insideAbort: calls[0].insideAbort, argumentCount: calls[0].args.length, self: calls[0].self },
        { insideAbort: true, argumentCount: 1, self: undefined },
      );
      abortError(reason)(calls[0].args[0]);
      // The listener goes away when the request ends. Nothing calls back a second time.
      await untilListeners(controller.signal, 0);
      await laterStats();
      assert.strictEqual(calls.length, 1);
    });

    test(`fs.${name}: calls back with the Stats when the signal stays live`, async () => {
      const controller = new AbortController();
      const log: string[] = [];
      const { promise, resolve } = Promise.withResolvers<{ args: any[]; self: unknown }>();
      call({ signal: controller.signal }, function (this: unknown, ...args: unknown[]) {
        process.nextTick(() => log.push("nextTick"));
        queueMicrotask(() => log.push("microtask"));
        log.push("callback");
        setImmediate(resolve, { args, self: this });
      });
      const { args, self } = await promise;
      assert.deepStrictEqual(
        { argumentCount: args.length, error: args[0], isFile: args[1].isFile(), self },
        { argumentCount: 2, error: null, isFile: true, self: undefined },
      );
      assert.deepStrictEqual(log, ["callback", "nextTick", "microtask"]);
      assert.strictEqual(listeners(controller.signal), 0);
      controller.abort();
    });

    test(`fs.${name}: calls back with the error of the stat when the signal stays live`, async () => {
      const controller = new AbortController();
      const { promise, resolve } = Promise.withResolvers<any[]>();
      fn(failing(), { signal: controller.signal }, (...args: unknown[]) => resolve(args));
      const args = await promise;
      assert.deepStrictEqual(
        { argumentCount: args.length, code: args[0].code, syscall: args[0].syscall },
        { argumentCount: 1, code: failingCode, syscall: name },
      );
      assert.strictEqual(listeners(controller.signal), 0);
    });

    for (const [outcome, subject] of [
      ["the Stats", target],
      ["the error of the stat", failing],
    ] as const) {
      test(`fs.${name}: the listener is gone when the callback gets ${outcome}, so abort() inside it calls back no more`, async () => {
        const controller = new AbortController();
        const calls: { error: string | null; listenersInside: number }[] = [];
        const { promise, resolve } = Promise.withResolvers<void>();
        fn(subject(), { signal: controller.signal }, (err: any) => {
          calls.push({ error: err ? (err.code ?? err.name) : null, listenersInside: listeners(controller.signal) });
          controller.abort();
          setImmediate(resolve);
        });
        assert.strictEqual(listeners(controller.signal), 1);
        await promise;
        await laterStats();
        assert.deepStrictEqual(calls, [{ error: outcome === "the Stats" ? null : failingCode, listenersInside: 0 }]);
      });
    }

    test(`fs.${name}: the callback of the stat runs in the context of the call`, async () => {
      const storage = new AsyncLocalStorage<string>();
      const controller = new AbortController();
      const { promise, resolve } = Promise.withResolvers<unknown>();
      storage.run("caller", () => call({ signal: controller.signal }, () => resolve(storage.getStore())));
      assert.strictEqual(await promise, "caller");
    });

    test(`fs.${name}: an earlier listener that stops propagation does not hide the abort`, async () => {
      const controller = new AbortController();
      controller.signal.addEventListener("abort", event => event.stopImmediatePropagation());
      const promise = promised({ signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, abortError(controller.signal.reason));
    });

    test(`fs.${name}: the aborted callback runs in listener order, in the context of abort()`, async () => {
      const storage = new AsyncLocalStorage<string>();
      const controller = new AbortController();
      const order: string[] = [];
      controller.signal.addEventListener("abort", () => order.push("before"));
      storage.run("caller", () =>
        call({ signal: controller.signal }, () => order.push(`callback:${storage.getStore()}`)),
      );
      controller.signal.addEventListener("abort", () => order.push("after"));
      storage.run("aborter", () => controller.abort());
      assert.deepStrictEqual(order, ["before", "callback:aborter", "after"]);
      await untilListeners(controller.signal, 2);
    });

    test(`fs.${name}: an object with an \`aborted\` property counts as a signal`, () => {
      let error: unknown;
      call({ signal: { aborted: true, reason: "r" } }, (err: unknown) => void (error = err));
      abortError("r")(error);
      assert.throws(() => call({ signal: { aborted: false } }, assert.fail), uncodedTypeError);
    });

    test(`fs.${name}: a signal that aborts while the call reads its options does not stop the call`, async () => {
      const controller = new AbortController();
      const options = {
        signal: controller.signal,
        get bigint() {
          controller.abort("in the getter");
          return false;
        },
      };
      // Node reads `bigint` before it adds its listener, and a listener that is added after the abort does not run.
      assert.ok((await promised(options)).isFile());
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test(`fs.${name}: bigint: true passes through with a signal`, async () => {
      const controller = new AbortController();
      const stats = (await promised({ bigint: true, signal: controller.signal })) as unknown as fs.BigIntStats;
      assert.deepStrictEqual([typeof stats.size, typeof stats.mtimeNs], ["bigint", "bigint"]);
      assert.strictEqual(listeners(controller.signal), 0);
    });

    test(`util.promisify(fs.${name}) rejects with the AbortError`, async () => {
      const signal = AbortSignal.abort();
      await assert.rejects(util.promisify(fn)(target(), { signal }), abortError(signal.reason));
      const controller = new AbortController();
      const promise = util.promisify(fn)(target(), { signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, abortError(controller.signal.reason));
    });
  }

  const pathForms = [fs.stat, fs.lstat] as ((path: any, options: any, callback: any) => void)[];
  const calledBack = (fn: (...args: any[]) => void, ...args: unknown[]) => {
    const { promise, resolve } = Promise.withResolvers<any[]>();
    fn(...args, (...results: unknown[]) => resolve(results));
    return promise;
  };

  test("fs.stat and fs.lstat check the signal type, the callback, then the path", () => {
    const signal = AbortSignal.abort();
    for (const fn of pathForms) {
      assert.throws(() => fn(123, { signal: "nope" }, "not a function"), signalTypeError("type string ('nope')"));
      assert.throws(() => fn(123, { signal }, "not a function"), callbackTypeError);
      const controller = new AbortController();
      assert.throws(() => fn(123, { signal: controller.signal }, assert.fail), pathTypeError);
      assert.throws(() => fn("a\0b", { signal: controller.signal }, assert.fail), { code: "ERR_INVALID_ARG_VALUE" });
      assert.strictEqual(listeners(controller.signal), 0);
      // The path is checked before anything is asked of the signal.
      assert.throws(() => fn(123, { signal: { aborted: false } }, assert.fail), pathTypeError);
    }
  });

  test("fs.stat and fs.lstat check the path before they look at aborted", () => {
    const signal = AbortSignal.abort();
    for (const fn of pathForms) {
      for (const path of [123, undefined, null, true, 1n, Symbol("s"), {}, [], new Date(0)]) {
        assert.throws(() => fn(path, { signal }, assert.fail), pathTypeError, util.inspect(path));
      }
      for (const path of ["a\0b", Buffer.from("a\0b")]) {
        assert.throws(() => fn(path, { signal }, assert.fail), { code: "ERR_INVALID_ARG_VALUE" }, util.inspect(path));
      }
      assert.throws(() => fn(new URL("http://example.com/"), { signal }, assert.fail), {
        code: "ERR_INVALID_URL_SCHEME",
      });
    }
  });

  test("fs.fstat checks the callback, the signal type, aborted, then the fd", () => {
    const signal = AbortSignal.abort();
    const fstat = fs.fstat as (fd: any, options?: any, callback?: any) => void;
    assert.throws(() => fstat("not an fd", { signal: "nope" }, "not a function"), callbackTypeError);
    assert.throws(() => fstat(fd, {}, "not a function"), callbackTypeError);
    assert.throws(() => fstat(fd), { ...callbackTypeError, message: /Received undefined$/ });
    assert.throws(() => fstat("not an fd", { signal: "nope" }, assert.fail), signalTypeError("type string ('nope')"));
    let error: unknown;
    fstat("not an fd", { signal }, (err: unknown) => void (error = err));
    abortError(signal.reason)(error);
    const controller = new AbortController();
    assert.throws(() => fstat("not an fd", { signal: controller.signal }, assert.fail), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "fd" argument must be of type number. Received type string ('not an fd')`,
    });
    assert.throws(() => fstat(-1, { signal: controller.signal }, assert.fail), {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received -1',
    });
    // Node adds its listener before the fd check throws, and leaves it there.
    assert.strictEqual(listeners(controller.signal), isBun ? 0 : 2);
  });

  test("fs.stat and fs.lstat read options.signal before they check the callback, and fs.fstat after", () => {
    const options = {
      get signal(): never {
        throw new RangeError("from the signal getter");
      },
    };
    for (const fn of pathForms) {
      assert.throws(() => fn(file, options, "not a function"), {
        name: "RangeError",
        message: "from the signal getter",
      });
    }
    assert.throws(() => (fs.fstat as any)(fd, options, "not a function"), callbackTypeError);
  });

  test("with a signal, fs.stat and fs.lstat take a Buffer and a URL as the path", async () => {
    const controller = new AbortController();
    for (const fn of pathForms) {
      for (const target of [Buffer.from(file), pathToFileURL(file)]) {
        const [error, stats] = await calledBack(fn, target, { signal: controller.signal });
        assert.deepStrictEqual([error, stats.isFile()], [null, true], util.inspect(target));
        abortError("r")((await calledBack(fn, target, { signal: AbortSignal.abort("r") }))[0]);
      }
    }
  });

  test(
    "with a signal, fs.lstat does not follow a link and fs.stat does",
    { skip: !canLink && "cannot create a symbolic link" },
    async () => {
      const { signal } = new AbortController();
      const [lstatError, lstatStats] = await calledBack(fs.lstat, link, { signal });
      const [statError, statStats] = await calledBack(fs.stat, link, { signal });
      assert.deepStrictEqual(
        { lstat: [lstatError, lstatStats.isSymbolicLink()], stat: [statError, statStats.isSymbolicLink()] },
        { lstat: [null, true], stat: [null, false] },
      );
      const [danglingLstatError, danglingLstatStats] = await calledBack(fs.lstat, dangling, { signal });
      const danglingStat = await calledBack(fs.stat, dangling, { signal });
      assert.deepStrictEqual(
        {
          lstat: [danglingLstatError, danglingLstatStats.isSymbolicLink()],
          stat: [danglingStat.length, danglingStat[0].code, danglingStat[0].syscall],
        },
        { lstat: [null, true], stat: [1, "ENOENT", "stat"] },
      );
    },
  );

  test("fs.stat with throwIfNoEntry: false and a signal calls back with no error and no Stats", async () => {
    const controller = new AbortController();
    assert.deepStrictEqual(await calledBack(fs.stat, missing, { throwIfNoEntry: false, signal: controller.signal }), [
      null,
      undefined,
    ]);
    assert.strictEqual(listeners(controller.signal), 0);
  });

  test("the sync forms do not read signal", () => {
    for (const signal of [AbortSignal.abort(), "nope", null]) {
      const options = { signal } as any;
      assert.ok(fs.statSync(file, options).isFile());
      assert.ok(fs.lstatSync(file, options).isFile());
      assert.ok(fs.fstatSync(fd, options).isFile());
    }
  });
});

describe("the text of an error, where Bun does not have the text of Node.js yet", () => {
  test(
    "a signal that is not an AbortSignal",
    { expectFailure: isBun && "Bun's validateAbortSignal says 'must be of type AbortSignal' (oven-sh/bun#38694)" },
    async () => {
      const message = `The "options.signal" property must be an instance of AbortSignal. Received type string ('nope')`;
      await assert.rejects(fsp.stat(file, { signal: "nope" } as any), { message });
      assert.throws(() => fs.stat(file, { signal: "nope" } as any, assert.fail as any), { message });
    },
  );

  test(
    "a path that is not a string, a Buffer or a URL",
    { expectFailure: isBun && "Bun's native check says 'path must be a string or TypedArray' (oven-sh/bun#35413)" },
    async () => {
      const message = `The "path" argument must be of type string or an instance of Buffer or URL. Received type number (123)`;
      const { signal } = new AbortController();
      await assert.rejects(fsp.stat(123 as any, { signal } as any), { message });
      assert.throws(() => fs.stat(123 as any, { signal } as any, assert.fail as any), { message });
    },
  );

  test(
    "a closed FileHandle",
    { expectFailure: isBun && "Bun reports a SystemError with the message 'Bad file descriptor'" },
    async () => {
      const handle = await fsp.open(file, "r");
      await handle.close();
      await assert.rejects(handle.stat({ signal: AbortSignal.abort() } as any), {
        name: "Error",
        code: "EBADF",
        syscall: "fstat",
        message: "file closed",
      });
    },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The expected values are those of v26.12.1. The signal itself is in v26.8.0 (nodejs/node#63143).
  const node = nodeExeAtLeast("26.12.1");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
