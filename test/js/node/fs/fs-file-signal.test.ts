/**
 * fs.readFile, fs.writeFile and fs.appendFile with an `options.signal` that is
 * already aborted. Node checks the signal with `checkAborted(signal, callback)`
 * and calls the callback before the call returns, so what the callback throws
 * reaches the caller:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L380-L386 (checkAborted)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L433-L453 (readFile)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L2925-L2964 (writeFile, appendFile calls it)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L2854-L2865 (writeAll, the fd form)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * Node.js, which is where the expected values come from. The last case runs it
 * there. It cannot import "harness" at the top for the same reason, so it
 * manages its own temporary directory.
 *
 * Where Bun differs from Node.js, the case says so: `expectFailure` marks what
 * Bun does not do yet.
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import util from "node:util";

const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";
const childEnv: NodeJS.ProcessEnv = isBun ? (await import("harness")).bunEnv : process.env;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-file-signal-"));
const file = path.join(dir, "f.txt");
const missing = path.join(dir, "missing.txt");
// Longer than a path can be on any platform: 4096 bytes on Linux, 1024 on macOS, 98302 on Windows.
const tooLong = (isWindows ? "C:\\" : "/") + Buffer.alloc(isWindows ? 100_000 : 5_000, "a").toString();
fs.writeFileSync(file, "hello");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let targets = 0;
/** A path in the temporary directory that no other case uses. */
const target = () => path.join(dir, `target-${targets++}.txt`);

type Callback = (...args: any[]) => void;
type Call = { self: unknown; args: unknown[] };

/** Starts a callback API and returns the calls its callback got, and how many of them before `start` returned. */
function callsBeforeReturn(start: (callback: Callback) => void) {
  const calls: Call[] = [];
  start(function (this: unknown, ...args: unknown[]) {
    calls.push({ self: this, args });
  });
  const beforeReturn = calls.length;
  return { calls, beforeReturn };
}

/** Resolves after the callbacks that are already on their way have run. */
async function settled() {
  await fsp.stat(dir);
  await new Promise(resolve => setImmediate(resolve));
}

function assertAbortError(err: any, signal: AbortSignal) {
  assert.deepStrictEqual(
    { name: err?.name, code: err?.code, message: err?.message },
    { name: "AbortError", code: "ABORT_ERR", message: "The operation was aborted" },
  );
  assert.ok(err instanceof Error);
  assert.strictEqual(err.cause, signal.reason);
}

/** One callback, before the call returned, with the AbortError alone and no `this`. Then none after. */
async function assertAbortedBeforeReturn(signal: AbortSignal, start: (callback: Callback) => void) {
  const { calls, beforeReturn } = callsBeforeReturn(start);
  assert.strictEqual(beforeReturn, 1, "the callback runs before the call returns");
  assert.strictEqual(calls[0].self, undefined);
  assert.strictEqual(calls[0].args.length, 1);
  assertAbortError(calls[0].args[0], signal);
  await settled();
  assert.strictEqual(calls.length, 1, "the callback runs once");
}

/** Runs `script` with this runtime and resolves with what it printed. */
function run(script: string) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | string | null }>(resolve => {
    execFile(process.execPath, ["-e", script], { env: childEnv, cwd: dir }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: error ? ((error as any).code ?? (error as any).signal) : 0 });
    });
  });
}

type Form = (signal: AbortSignal, callback: Callback, fd: number) => void;
/** Every form that node answers before it returns. `@types/node` has no `signal` for appendFile. */
const forms: Record<string, Form> = {
  "fs.readFile(path)": (signal, cb) => fs.readFile(file, { signal }, cb),
  "fs.readFile(path) with an encoding": (signal, cb) => fs.readFile(file, { signal, encoding: "utf8" }, cb),
  "fs.readFile(Buffer)": (signal, cb) => fs.readFile(Buffer.from(file), { signal }, cb),
  "fs.readFile(URL)": (signal, cb) => fs.readFile(pathToFileURL(file), { signal }, cb),
  "fs.readFile(path) of a file that does not exist": (signal, cb) => fs.readFile(missing, { signal }, cb),
  "fs.readFile(path) of a path that is too long": (signal, cb) => fs.readFile(tooLong, { signal }, cb),
  "fs.writeFile(path)": (signal, cb) => fs.writeFile(missing, "x", { signal }, cb),
  "fs.writeFile(Buffer) of a Buffer": (signal, cb) =>
    fs.writeFile(Buffer.from(missing), Buffer.from("x"), { signal }, cb),
  "fs.writeFile(path) with flush": (signal, cb) => fs.writeFile(missing, "x", { signal, flush: true }, cb),
  "fs.writeFile(fd)": (signal, cb, fd) => fs.writeFile(fd, "x", { signal }, cb),
  "fs.appendFile(path)": (signal, cb) => fs.appendFile(missing, "x", { signal } as any, cb),
  "fs.appendFile(fd)": (signal, cb, fd) => fs.appendFile(fd, "x", { signal } as any, cb),
};

describe("a signal that is already aborted: the callback runs before the call returns", () => {
  for (const [name, form] of Object.entries(forms)) {
    test(name, async () => {
      const fd = fs.openSync(file, "r+");
      try {
        const signal = AbortSignal.abort();
        await assertAbortedBeforeReturn(signal, callback => form(signal, callback, fd));
        // Nothing was read, written or made.
        assert.strictEqual(fs.readFileSync(file, "utf8"), "hello");
        assert.strictEqual(fs.existsSync(missing), false);
      } finally {
        fs.closeSync(fd);
      }
    });
  }

  test("the cause is the reason of the signal, and each call makes its own error", () => {
    const reason = new Error("my reason");
    const signal = AbortSignal.abort(reason);
    assert.strictEqual(signal.reason, reason);
    const errors: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const { calls } = callsBeforeReturn(callback => fs.readFile(file, { signal }, callback));
      assert.strictEqual(calls.length, 1);
      assertAbortError(calls[0].args[0], signal);
      errors.push(calls[0].args[0]);
    }
    assert.notStrictEqual(errors[0], errors[1]);
  });

  test("a signal that follows an aborted one", async () => {
    const signal = AbortSignal.any([AbortSignal.abort()]);
    await assertAbortedBeforeReturn(signal, callback => fs.readFile(file, { signal }, callback));
  });

  test("what was queued before the call runs after the callback", async () => {
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const queued = (name: string) => () => {
      order.push(name);
      if (order.length === 4) resolve();
    };
    process.nextTick(queued("nextTick"));
    queueMicrotask(queued("microtask"));
    fs.writeFile(missing, "x", { signal: AbortSignal.abort() }, queued("callback"));
    queued("returned")();
    await promise;
    // Which of the two queues runs first depends on where the caller is.
    assert.deepStrictEqual(
      [...order.slice(0, 2), ...order.slice(2).sort()],
      ["callback", "returned", "microtask", "nextTick"],
    );
  });

  test("the callback runs in the AsyncLocalStorage store of the caller", () => {
    const storage = new AsyncLocalStorage<string>();
    const stores: unknown[] = [];
    storage.run("caller", () => {
      for (const form of Object.values(forms)) {
        const fd = fs.openSync(file, "r+");
        try {
          form(AbortSignal.abort(), () => stores.push(storage.getStore()), fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    });
    assert.deepStrictEqual(
      stores,
      Object.keys(forms).map(() => "caller"),
    );
  });

  test("a callback that makes the call again runs inside the first call", () => {
    const signal = AbortSignal.abort();
    let depth = 0;
    let deepest = 0;
    let calls = 0;
    function again() {
      deepest = Math.max(deepest, ++depth);
      if (++calls < 5) fs.readFile(file, { signal }, again);
      depth--;
    }
    fs.readFile(file, { signal }, again);
    assert.deepStrictEqual({ calls, deepest }, { calls: 5, deepest: 5 });
  });

  test("util.promisify rejects", async () => {
    const signal = AbortSignal.abort();
    const rejection = (err: unknown) => (assertAbortError(err, signal), true);
    await assert.rejects(util.promisify(fs.readFile)(file, { signal } as any), rejection);
    await assert.rejects(util.promisify(fs.writeFile)(missing, "x", { signal }), rejection);
    await assert.rejects(util.promisify(fs.appendFile)(missing, "x", { signal } as any), rejection);
    assert.strictEqual(fs.existsSync(missing), false);
  });

  // On the next tick the process is gone, and the callback was never called.
  test("when the process exits before the next tick", async () => {
    const calls = `
      const fs = require("node:fs");
      const signal = AbortSignal.abort();
      const ran = [];
      const all = () => {
        fs.readFile(${JSON.stringify(file)}, { signal }, err => ran.push("readFile " + err.name));
        fs.writeFile(${JSON.stringify(missing)}, "x", { signal }, err => ran.push("writeFile " + err.name));
        fs.appendFile(${JSON.stringify(missing)}, "x", { signal }, err => ran.push("appendFile " + err.name));
        console.log(JSON.stringify(ran));
      };
    `;
    const ran = JSON.stringify(["readFile AbortError", "writeFile AbortError", "appendFile AbortError"]);
    const results = await Promise.all([
      run(`${calls} process.on("exit", all);`),
      run(`${calls} all(); process.exit(0);`),
      run(
        `require("node:fs").writeFile(${JSON.stringify(missing)}, "x", { signal: AbortSignal.abort() }, () => process.exit(3)); process.exit(0);`,
      ),
    ]);
    assert.deepStrictEqual(
      results.map(result => ({ ...result, stdout: result.stdout.trim() })),
      [
        { stdout: ran, stderr: "", exitCode: 0 },
        { stdout: ran, stderr: "", exitCode: 0 },
        { stdout: "", stderr: "", exitCode: 3 },
      ],
    );
  });
});

describe("a signal that is already aborted: what the callback throws reaches the caller", () => {
  for (const [name, form] of Object.entries(forms)) {
    test(name, async () => {
      const fd = fs.openSync(file, "r+");
      try {
        const thrown = new Error("thrown by the callback");
        let calls = 0;
        const call = () =>
          form(
            AbortSignal.abort(),
            () => {
              calls++;
              throw thrown;
            },
            fd,
          );
        assert.throws(call, err => err === thrown);
        await settled();
        assert.strictEqual(calls, 1);
      } finally {
        fs.closeSync(fd);
      }
    });
  }
});

describe("a signal that is already aborted: what node checks before it still throws", () => {
  const invalid: Record<string, [(signal: AbortSignal, callback: any) => void, { name: string; code: string }]> = {
    "fs.readFile with a callback that is no function": [
      signal => fs.readFile(file, { signal }, "no function" as any),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
    "fs.readFile with an invalid encoding": [
      (signal, cb) => fs.readFile(file, { signal, encoding: "bogus" as any }, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" },
    ],
    "fs.writeFile with a callback that is no function": [
      signal => fs.writeFile(target(), "x", { signal }, "no function" as any),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
    "fs.writeFile with an invalid encoding": [
      (signal, cb) => fs.writeFile(target(), "x", { signal, encoding: "bogus" as any }, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" },
    ],
    "fs.writeFile with a flush that is no boolean": [
      (signal, cb) => fs.writeFile(target(), "x", { signal, flush: "no" as any }, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
    "fs.writeFile with an invalid mode": [
      (signal, cb) => fs.writeFile(target(), "x", { signal, mode: "bogus" }, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" },
    ],
    "fs.writeFile of an object": [
      (signal, cb) => fs.writeFile(target(), {} as any, { signal }, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
    "fs.appendFile with a flush that is no boolean": [
      (signal, cb) => fs.appendFile(target(), "x", { signal, flush: "no" } as any, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
    "fs.appendFile of an object": [
      (signal, cb) => fs.appendFile(target(), {} as any, { signal } as any, cb),
      { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    ],
  };
  for (const [name, [start, expected]] of Object.entries(invalid)) {
    test(name, async () => {
      let calls = 0;
      assert.throws(() => start(AbortSignal.abort(), () => calls++), expected);
      await settled();
      assert.strictEqual(calls, 0);
    });
  }
});

describe("a signal that is aborted while the options are read", () => {
  /** Options with the signal of `controller`, and a getter for `name` that aborts it before it answers `value`. */
  function abortsWhenRead(controller: AbortController, name: string, value: unknown): any {
    return Object.defineProperty({ signal: controller.signal }, name, {
      enumerable: true,
      get() {
        controller.abort();
        return value;
      },
    });
  }

  // Node reads these options before it checks the signal.
  const before: [string, string, unknown, (options: any, callback: Callback) => void][] = [
    ["fs.readFile", "encoding", "utf8", (options, cb) => fs.readFile(file, options, cb)],
    ["fs.writeFile", "encoding", "utf8", (options, cb) => fs.writeFile(missing, "x", options, cb)],
    ["fs.writeFile", "flush", false, (options, cb) => fs.writeFile(missing, "x", options, cb)],
    ["fs.writeFile", "mode", 0o666, (options, cb) => fs.writeFile(missing, "x", options, cb)],
    ["fs.writeFile", "flag", "w", (options, cb) => fs.writeFile(missing, "x", options, cb)],
    ["fs.appendFile", "flag", "a", (options, cb) => fs.appendFile(missing, "x", options, cb)],
  ];
  for (const [api, name, value, start] of before) {
    test(`${api}: ${name} is read before the signal is checked`, async () => {
      const controller = new AbortController();
      const options = abortsWhenRead(controller, name, value);
      await assertAbortedBeforeReturn(controller.signal, callback => start(options, callback));
      assert.strictEqual(fs.existsSync(missing), false);
    });
  }

  test(
    "fs.readFile: flag is read after the signal is checked, so the read starts",
    { expectFailure: isBun && "Bun reads the flag before the signal, and calls back before it returns" },
    async () => {
      const controller = new AbortController();
      const options = abortsWhenRead(controller, "flag", "r");
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const { calls, beforeReturn } = callsBeforeReturn(callback =>
        fs.readFile(file, options, (...args) => {
          callback(...args);
          resolve(args[0]);
        }),
      );
      assert.strictEqual(beforeReturn, 0);
      assert.strictEqual(controller.signal.aborted, true);
      assertAbortError(await promise, controller.signal);
      await settled();
      assert.strictEqual(calls.length, 1);
    },
  );
});

describe("what a callback still hears after the call returned", () => {
  test("fs.readFile(fd) with a signal that is already aborted", async () => {
    const fd = fs.openSync(file, "r");
    try {
      const signal = AbortSignal.abort();
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      const { beforeReturn } = callsBeforeReturn(callback =>
        fs.readFile(fd, { signal }, (...args) => {
          callback(...args);
          resolve(args);
        }),
      );
      assert.strictEqual(beforeReturn, 0);
      const args = await promise;
      // Node.js defers this form, and then loses the AbortError: ReadFileContext.close() drops it for an fd
      // (https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/read/context.js#L179-L185). Bun reports it.
      if (isBun) assertAbortError(args[0], signal);
      else assert.deepStrictEqual(args, [null, Buffer.alloc(0)]);
    } finally {
      fs.closeSync(fd);
    }
  });

  test("a signal that is never aborted", async () => {
    const { signal } = new AbortController();
    const written = target();
    for (const start of [
      (callback: Callback) => fs.readFile(file, { signal, encoding: "utf8" }, callback),
      (callback: Callback) => fs.writeFile(written, "x", { signal }, callback),
      (callback: Callback) => fs.appendFile(written, "y", { signal } as any, callback),
    ]) {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const { beforeReturn } = callsBeforeReturn(callback =>
        start((...args) => {
          callback(...args);
          resolve(args[0]);
        }),
      );
      assert.strictEqual(beforeReturn, 0);
      assert.strictEqual(await promise, null);
    }
    assert.strictEqual(fs.readFileSync(written, "utf8"), "xy");
  });

  test("a signal that is aborted after the call returned", async () => {
    for (const start of [
      (signal: AbortSignal, callback: Callback) => fs.readFile(file, { signal }, callback),
      (signal: AbortSignal, callback: Callback) => fs.writeFile(target(), "x", { signal }, callback),
      (signal: AbortSignal, callback: Callback) => fs.appendFile(target(), "x", { signal } as any, callback),
    ]) {
      const controller = new AbortController();
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const { calls, beforeReturn } = callsBeforeReturn(callback =>
        start(controller.signal, (...args) => {
          callback(...args);
          resolve(args[0]);
        }),
      );
      controller.abort();
      assert.strictEqual(beforeReturn, 0);
      assertAbortError(await promise, controller.signal);
      await settled();
      assert.strictEqual(calls.length, 1);
    }
  });

  test("the promise forms reject", async () => {
    const signal = AbortSignal.abort();
    const rejection = (err: unknown) => (assertAbortError(err, signal), true);
    await assert.rejects(fsp.readFile(file, { signal }), rejection);
    await assert.rejects(fsp.writeFile(missing, "x", { signal }), rejection);
    await assert.rejects(fsp.appendFile(missing, "x", { signal } as any), rejection);
    assert.strictEqual(fs.existsSync(missing), false);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { nodeExeAtLeast } = await import("harness");
  // The expected values are those of v26.12.1, the version that Bun reports.
  const node = nodeExeAtLeast("26.12.1");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      const { promise, resolve } = Promise.withResolvers<{ exitCode: unknown; output: string }>();
      execFile(node!, [fileURLToPath(import.meta.url)], { env: childEnv }, (error, stdout, stderr) => {
        resolve({ exitCode: error ? ((error as any).code ?? (error as any).signal) : 0, output: stdout + stderr });
      });
      const { exitCode, output } = await promise;
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : output }, { exitCode: 0, output: "" });
    });
  });
}
