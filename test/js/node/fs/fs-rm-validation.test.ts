/**
 * fs.rm(path[, options], callback) validates its arguments before it starts any
 * work. An invalid argument throws from the call itself and the callback never
 * runs. Only an error that the file system reports reaches the callback:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L1176-L1190 (rm)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L933-L965 (validateRmOptions)
 *
 * fs.promises.rm() and fs.rmSync() validate the options before they look at the
 * path on disk, so an invalid option wins over ERR_FS_EISDIR and ENOENT.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot import
 * from "harness" for the same reason, so it manages its own temporary directory.
 * It compares the name and the code of an argument error, not its message: Bun
 * words those messages differently for every fs function.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

const isBun = typeof process.versions.bun === "string";
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const isRoot = !isWindows && process.getuid!() === 0;

type Expected = { name: string; code: string };
const invalidArgType: Expected = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" };
const invalidArgValue: Expected = { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" };
const outOfRange: Expected = { name: "RangeError", code: "ERR_OUT_OF_RANGE" };

const invalidPaths: [string, unknown, Expected][] = [
  ["number", 123, invalidArgType],
  ["undefined", undefined, invalidArgType],
  ["null", null, invalidArgType],
  ["boolean", true, invalidArgType],
  ["object", {}, invalidArgType],
  ["array", ["a"], invalidArgType],
  ["symbol", Symbol("path"), invalidArgType],
  ["bigint", 1n, invalidArgType],
  ["function", () => {}, invalidArgType],
  ["string with a NUL byte", "a\0b", invalidArgValue],
  ["Buffer with a NUL byte", Buffer.from("a\0b"), invalidArgValue],
  ["Uint8Array with a NUL byte", new Uint8Array([97, 0, 98]), invalidArgValue],
  ["http: URL", new URL("http://example.com/a"), { name: "TypeError", code: "ERR_INVALID_URL_SCHEME" }],
];
if (!isWindows) {
  // On Windows a file: URL with a host is a UNC path, and a file: URL needs a drive letter.
  invalidPaths.push(
    ["file: URL with a host", new URL("file://host/a"), { name: "TypeError", code: "ERR_INVALID_FILE_URL_HOST" }],
    ["file: URL with %2F", new URL("file:///a%2Fb"), { name: "TypeError", code: "ERR_INVALID_FILE_URL_PATH" }],
    ["file: URL with a NUL byte", new URL("file:///a%00b"), invalidArgValue],
  );
}

const invalidOptions: [string, unknown, Expected][] = [
  ["null", null, invalidArgType],
  ["string", "recursive", invalidArgType],
  ["number", 1, invalidArgType],
  ["boolean", true, invalidArgType],
  ["{ recursive: 'yes' }", { recursive: "yes" }, invalidArgType],
  ["{ recursive: null }", { recursive: null }, invalidArgType],
  ["{ recursive: undefined }", { recursive: undefined }, invalidArgType],
  ["{ force: 1 }", { force: 1 }, invalidArgType],
  ["{ force: undefined }", { force: undefined }, invalidArgType],
  ["{ retryDelay: -1 }", { retryDelay: -1 }, outOfRange],
  ["{ retryDelay: 0.5 }", { retryDelay: 0.5 }, outOfRange],
  ["{ retryDelay: '1' }", { retryDelay: "1" }, invalidArgType],
  ["{ maxRetries: -1 }", { maxRetries: -1 }, outOfRange],
  ["{ maxRetries: 2 ** 32 }", { maxRetries: 2 ** 32 }, outOfRange],
  ["{ maxRetries: NaN }", { maxRetries: NaN }, outOfRange],
  ["{ maxRetries: '1' }", { maxRetries: "1" }, invalidArgType],
];

const validOptions: [string, fs.RmOptions | undefined][] = [
  ["no options", undefined],
  ["{}", {}],
  ["{ recursive: true }", { recursive: true }],
  ["{ force: true }", { force: true }],
  [
    "{ recursive: true, force: true, maxRetries: 3, retryDelay: 10 }",
    { recursive: true, force: true, maxRetries: 3, retryDelay: 10 },
  ],
];

/** A callback that records a call it must never get. */
function recorder() {
  const calls: unknown[][] = [];
  return { calls, callback: (...args: unknown[]) => void calls.push(args) };
}

/** Resolves after every callback that an earlier call could have queued: a tick, a promise reaction, a finished lstat. */
async function settle() {
  await new Promise<void>(resolve => setImmediate(resolve));
  await fs.promises.lstat(tmp);
  await new Promise<void>(resolve => setImmediate(resolve));
}

/** Calls `start(callback)` and resolves with the error the callback gets. Rejects if the callback runs before `start` returns. */
function viaCallback(start: (callback: (err: NodeJS.ErrnoException | null) => void) => unknown) {
  return new Promise<NodeJS.ErrnoException | null>((resolve, reject) => {
    let returned = false;
    const result = start(err => {
      if (returned) resolve(err);
      else reject(new Error("the callback ran before the call returned"));
    });
    returned = true;
    if (result !== undefined) reject(new Error(`expected the call to return undefined, got ${String(result)}`));
  });
}

/** The named properties of an error, inherited ones included. */
function pick(err: unknown, ...keys: string[]) {
  assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
  return Object.fromEntries(keys.map(key => [key, (err as any)[key]]));
}

function isDirectoryError(target: string) {
  return {
    name: "SystemError",
    code: "ERR_FS_EISDIR",
    message: `Path is a directory: rm returned EISDIR (is a directory) ${target}`,
    syscall: "rm",
    path: target,
    errno: os.constants.errno.EISDIR,
  };
}
const isDirectoryErrorKeys = ["name", "code", "message", "syscall", "path", "errno"];

/** The outcome of rm(target, options) in the callback, promise and sync forms: the picked error properties, or null. */
async function outcomes(target: fs.PathLike, options: fs.RmOptions | undefined, ...keys: string[]) {
  const callback = await viaCallback(cb => (options === undefined ? fs.rm(target, cb) : fs.rm(target, options, cb)));
  const promise = await fs.promises.rm(target, options).then(
    () => null,
    err => err,
  );
  let sync: unknown = null;
  try {
    fs.rmSync(target, options);
  } catch (err) {
    sync = err;
  }
  if (promise) assert.strictEqual(typeof promise.stack, "string");
  if (sync) assert.strictEqual(typeof (sync as Error).stack, "string");
  return {
    callback: callback && pick(callback, ...keys),
    promise: promise && pick(promise, ...keys),
    sync: sync && pick(sync, ...keys),
  };
}

let tmp: string;
let dir: string;
let file: string;
let missing: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-rm-validation-"));
  dir = path.join(tmp, "dir");
  file = path.join(tmp, "file.txt");
  missing = path.join(tmp, "missing");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "child.txt"), "child");
  fs.writeFileSync(file, "file");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("fs.rm(path[, options], callback)", () => {
  test("throws for an invalid path and does not call the callback", async () => {
    const { calls, callback } = recorder();
    for (const [label, invalid, expected] of invalidPaths) {
      for (const [optionsLabel, options] of validOptions) {
        const call =
          options === undefined
            ? () => fs.rm(invalid as any, callback)
            : () => fs.rm(invalid as any, options, callback);
        assert.throws(call, expected, `fs.rm(${label}, ${optionsLabel}, callback)`);
      }
    }
    await settle();
    assert.deepStrictEqual(calls, []);
  });

  test("throws for invalid options and does not call the callback", async () => {
    const { calls, callback } = recorder();
    for (const [label, invalid, expected] of invalidOptions) {
      // The option error wins over ENOENT for a missing path and over ERR_FS_EISDIR for a directory.
      for (const target of [missing, dir, file]) {
        assert.throws(() => fs.rm(target, invalid as any, callback), expected, `fs.rm(${target}, ${label}, callback)`);
      }
    }
    await settle();
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(fs.readdirSync(tmp).sort(), ["dir", "file.txt"]);
  });

  test("reports an invalid path before invalid options", async () => {
    const { calls, callback } = recorder();
    assert.throws(() => fs.rm("a\0b", { maxRetries: -1 }, callback), invalidArgValue);
    assert.throws(() => fs.rm(new URL("http://example.com/a"), null as any, callback), {
      name: "TypeError",
      code: "ERR_INVALID_URL_SCHEME",
    });
    await settle();
    assert.deepStrictEqual(calls, []);
  });

  test("passes an error from the file system to the callback", async () => {
    for (const [optionsLabel, options] of validOptions) {
      if (options?.force) continue;
      const err = await viaCallback(cb => (options === undefined ? fs.rm(missing, cb) : fs.rm(missing, options, cb)));
      assert.deepStrictEqual(
        pick(err, "name", "code", "syscall", "path"),
        { name: "Error", code: "ENOENT", syscall: "lstat", path: missing },
        optionsLabel,
      );
    }

    for (const options of [undefined, {}, { recursive: false }, { force: true }]) {
      const err = await viaCallback(cb => (options === undefined ? fs.rm(dir, cb) : fs.rm(dir, options, cb)));
      assert.deepStrictEqual(pick(err, ...isDirectoryErrorKeys), isDirectoryError(dir));
    }
    assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
  });

  test("removes the path and calls back with null", async () => {
    const target = path.join(tmp, "target.txt");
    fs.writeFileSync(target, "target");
    assert.strictEqual(await viaCallback(cb => fs.rm(target, cb)), null);
    assert.strictEqual(fs.existsSync(target), false);

    assert.strictEqual(await viaCallback(cb => fs.rm(missing, { force: true }, cb)), null);

    const tree = path.join(tmp, "tree");
    fs.mkdirSync(path.join(tree, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(tree, "a", "b", "c.txt"), "c");
    assert.strictEqual(await viaCallback(cb => fs.rm(tree, { recursive: true }, cb)), null);
    assert.strictEqual(fs.existsSync(tree), false);

    for (const toPathLike of [pathToFileURL, Buffer.from]) {
      fs.writeFileSync(target, "target");
      assert.strictEqual(await viaCallback(cb => fs.rm(toPathLike(target), cb)), null);
      assert.strictEqual(fs.existsSync(target), false);
    }
  });

  test("does not go through fs.promises.rm", async () => {
    const target = path.join(tmp, "independent.txt");
    fs.writeFileSync(target, "independent");
    const original = fs.promises.rm;
    fs.promises.rm = async () => {};
    try {
      assert.strictEqual(await viaCallback(cb => fs.rm(target, cb)), null);
    } finally {
      fs.promises.rm = original;
    }
    assert.strictEqual(fs.existsSync(target), false);
  });

  test("reads each option once, from the object's own enumerable keys", async () => {
    // Node copies the options with `{ ...defaults, ...options }` before the call returns.
    let reads = 0;
    const counted = {
      get recursive() {
        reads++;
        return false;
      },
    };
    assert.strictEqual((await viaCallback(cb => fs.rm(dir, counted, cb)))?.code, "ERR_FS_EISDIR");
    assert.strictEqual(reads, 1);

    const inherited = Object.create({ recursive: true, force: true });
    const hidden = Object.defineProperties({}, { recursive: { value: true }, force: { value: true } });
    for (const options of [inherited, hidden]) {
      assert.strictEqual((await viaCallback(cb => fs.rm(dir, options, cb)))?.code, "ERR_FS_EISDIR");
      assert.strictEqual((await viaCallback(cb => fs.rm(missing, options, cb)))?.code, "ENOENT");
    }
    // A key that the copy leaves out is not validated.
    const hiddenInvalid = Object.defineProperty({}, "force", { value: "yes" });
    assert.strictEqual((await viaCallback(cb => fs.rm(missing, hiddenInvalid, cb)))?.code, "ENOENT");

    const changed = { recursive: false };
    const pending = viaCallback(cb => fs.rm(dir, changed, cb));
    changed.recursive = true;
    assert.strictEqual((await pending)?.code, "ERR_FS_EISDIR");

    const proxied = new Proxy({ force: true }, {});
    assert.strictEqual(await viaCallback(cb => fs.rm(missing, proxied, cb)), null);
    assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
  });
});

describe("fs.promises.rm(path[, options])", () => {
  test("rejects for an invalid path", async () => {
    for (const [label, invalid, expected] of invalidPaths) {
      const promise = fs.promises.rm(invalid as any);
      assert.ok(promise instanceof Promise, `fs.promises.rm(${label}) returns a promise`);
      await assert.rejects(promise, expected, `fs.promises.rm(${label})`);
    }
  });

  test("rejects for invalid options, before it looks at the path on disk", async () => {
    for (const [label, invalid, expected] of invalidOptions) {
      for (const target of [missing, dir, file]) {
        const promise = fs.promises.rm(target, invalid as any);
        assert.ok(promise instanceof Promise, `fs.promises.rm(path, ${label}) returns a promise`);
        await assert.rejects(promise, expected, `fs.promises.rm(${target}, ${label})`);
      }
    }
    assert.deepStrictEqual(fs.readdirSync(tmp).sort(), ["dir", "file.txt"]);
  });
});

describe("fs.rmSync(path[, options])", () => {
  test("throws for an invalid path", () => {
    for (const [label, invalid, expected] of invalidPaths) {
      assert.throws(() => fs.rmSync(invalid as any), expected, `fs.rmSync(${label})`);
    }
  });

  test("throws for invalid options, before it looks at the path on disk", () => {
    for (const [label, invalid, expected] of invalidOptions) {
      for (const target of [missing, dir, file]) {
        assert.throws(() => fs.rmSync(target, invalid as any), expected, `fs.rmSync(${target}, ${label})`);
      }
    }
    assert.deepStrictEqual(fs.readdirSync(tmp).sort(), ["dir", "file.txt"]);
  });
});

describe("rm without `recursive`", () => {
  test("refuses a directory with ERR_FS_EISDIR in every form", async () => {
    for (const target of [dir, dir + path.sep]) {
      for (const options of [undefined, { force: true }]) {
        const expected = isDirectoryError(target);
        assert.deepStrictEqual(await outcomes(target, options, ...isDirectoryErrorKeys), {
          callback: expected,
          promise: expected,
          sync: expected,
        });
      }
    }
    const info = {
      code: "EISDIR",
      message: "is a directory",
      path: dir,
      syscall: "rm",
      errno: os.constants.errno.EISDIR,
    };
    assert.deepStrictEqual(await outcomes(dir, undefined, "info"), {
      callback: { info },
      promise: { info },
      sync: { info },
    });
    assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
  });

  test("reports the path of a Buffer or a file: URL as a string", async () => {
    const expected = isDirectoryError(dir);
    assert.deepStrictEqual(await outcomes(Buffer.from(dir), undefined, ...isDirectoryErrorKeys), {
      callback: expected,
      promise: expected,
      sync: expected,
    });

    // Node's rmSync() builds the error before it converts the URL, so its `path` is the href.
    const { callback, promise, sync } = await outcomes(pathToFileURL(dir), undefined, ...isDirectoryErrorKeys);
    assert.deepStrictEqual({ callback, promise }, { callback: expected, promise: expected });
    assert.deepStrictEqual(sync, isBun ? expected : isDirectoryError(pathToFileURL(dir).href));
  });

  test("follows a symlink that has a trailing slash", { skip: isWindows }, async () => {
    const link = path.join(tmp, "link-to-dir");
    fs.symlinkSync("dir", link);
    try {
      const expected = isDirectoryError(link + "/");
      assert.deepStrictEqual(await outcomes(link + "/", undefined, ...isDirectoryErrorKeys), {
        callback: expected,
        promise: expected,
        sync: expected,
      });
      assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
      assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true);
    } finally {
      fs.unlinkSync(link);
    }
  });

  // Linux file names are bytes. macOS and Windows refuse a name that is not Unicode.
  test("refuses a directory whose name is not UTF-8", { skip: !isLinux }, async () => {
    const name = Buffer.concat([Buffer.from(tmp + path.sep + "d"), Buffer.from([0xff]), Buffer.from("r")]);
    fs.mkdirSync(name);
    try {
      const expected = { code: "ERR_FS_EISDIR", syscall: "rm", path: name.toString() };
      assert.deepStrictEqual(await outcomes(name, undefined, "code", "syscall", "path"), {
        callback: expected,
        promise: expected,
        sync: expected,
      });
    } finally {
      fs.rmdirSync(name);
    }
  });

  // unlink() fails with EACCES here before it looks at the target. root ignores the mode of the parent.
  test("refuses a directory, and keeps a file, in a read-only parent", { skip: isWindows || isRoot }, async () => {
    const parent = path.join(tmp, "read-only");
    fs.mkdirSync(path.join(parent, "dir"), { recursive: true });
    fs.writeFileSync(path.join(parent, "file.txt"), "file");
    fs.chmodSync(parent, 0o555);
    try {
      const expected = isDirectoryError(path.join(parent, "dir"));
      assert.deepStrictEqual(await outcomes(expected.path, undefined, ...isDirectoryErrorKeys), {
        callback: expected,
        promise: expected,
        sync: expected,
      });

      const denied = { code: "EACCES", path: path.join(parent, "file.txt") };
      assert.deepStrictEqual(await outcomes(denied.path, undefined, "code", "path"), {
        callback: denied,
        promise: denied,
        sync: denied,
      });
      assert.deepStrictEqual(fs.readdirSync(parent).sort(), ["dir", "file.txt"]);
    } finally {
      fs.chmodSync(parent, 0o755);
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

// Node v26 removed the `recursive` option of rmdir (DEP0147). Its callback form throws ERR_INVALID_ARG_VALUE for the
// option before it reads the path. Bun keeps the option and sends it through rm, where the path comes first, as in Node v24:
// https://github.com/nodejs/node/blob/v24.0.0/lib/fs.js#L1124-L1159
describe("rmdir with `recursive`", () => {
  const unsupported: Expected = { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" };
  // The types of rmdir no longer take options.
  const rmdir = fs.rmdir as Function;
  const rmdirSync = fs.rmdirSync as Function;
  const rmdirPromise = fs.promises.rmdir as Function;

  test("fs.rmdir() throws for an invalid path and does not call the callback", async () => {
    const { calls, callback } = recorder();
    for (const [label, invalid, expected] of invalidPaths) {
      assert.throws(
        () => rmdir(invalid, { recursive: true }, callback),
        isBun ? expected : unsupported,
        `fs.rmdir(${label}, { recursive: true }, callback)`,
      );
    }
    await settle();
    assert.deepStrictEqual(calls, []);
  });

  test("fs.rmdir() throws for invalid options and does not call the callback", async () => {
    const { calls, callback } = recorder();
    for (const [label, invalid, expected] of invalidOptions) {
      if (typeof invalid !== "object" || invalid === null) continue;
      const options = { recursive: true, ...invalid };
      if (!options.recursive) continue;
      for (const target of [missing, dir]) {
        assert.throws(
          () => rmdir(target, options, callback),
          isBun ? expected : unsupported,
          `fs.rmdir(${target}, { recursive: true, ...${label} }, callback)`,
        );
      }
    }
    await settle();
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
  });

  test("fs.promises.rmdir() rejects and fs.rmdirSync() throws for the same arguments", async () => {
    // Both read the path first, in Node too.
    for (const [label, invalid, expected] of invalidPaths) {
      await assert.rejects(rmdirPromise(invalid, { recursive: true }), expected, `fs.promises.rmdir(${label})`);
      assert.throws(() => rmdirSync(invalid, { recursive: true }), expected, `fs.rmdirSync(${label})`);
    }
    for (const [label, invalid, expected] of invalidOptions) {
      if (typeof invalid !== "object" || invalid === null) continue;
      const options = { recursive: true, ...invalid };
      if (!options.recursive) continue;
      const error = isBun ? expected : unsupported;
      await assert.rejects(rmdirPromise(dir, options), error, `fs.promises.rmdir(dir, ${label})`);
      assert.throws(() => rmdirSync(dir, options), error, `fs.rmdirSync(dir, ${label})`);
    }
    assert.deepStrictEqual(fs.readdirSync(dir), ["child.txt"]);
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/dir.js#L109-L122
describe("dir.read() on a closed Dir", () => {
  test("throws ERR_DIR_CLOSED from the call when it has an argument", async () => {
    const closed = fs.opendirSync(tmp);
    closed.closeSync();
    const expected = { name: "Error", code: "ERR_DIR_CLOSED", message: "Directory handle was closed" };

    const { calls, callback } = recorder();
    assert.throws(() => closed.read(callback), expected);
    assert.throws(() => (closed.read as Function)(undefined), expected);
    assert.throws(() => (closed.read as Function)(null), expected);
    await settle();
    assert.deepStrictEqual(calls, []);

    // Without an argument it returns a promise that rejects. close(callback) reports the error to its callback.
    const promise = closed.read();
    assert.ok(promise instanceof Promise);
    await assert.rejects(promise, expected);
    assert.deepStrictEqual(pick(await viaCallback(cb => closed.close(cb)), "name", "code", "message"), expected);
  });

  test("validates the callback of an open Dir", async () => {
    const open = fs.opendirSync(tmp);
    try {
      assert.throws(() => (open.read as Function)(null), invalidArgType);
      assert.throws(() => (open.read as Function)("callback"), invalidArgType);
      // An explicit `undefined` is the promise form.
      const entry = await (open.read as Function)(undefined);
      assert.ok(entry === null || typeof entry.name === "string");
    } finally {
      open.closeSync();
    }
  });
});
