/**
 * Bun's path parser threw `TypeError [ERR_INVALID_ARG_TYPE]: Invalid path buffer: can't be empty`
 * for a zero-length Buffer or Uint8Array path. Node's validatePath() checks the type and the NUL
 * bytes of a path, not its length:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L831-L851
 * and BufferValue copies the zero bytes into the same "" that an empty string gives:
 * https://github.com/nodejs/node/blob/v26.3.0/src/util.cc#L156-L177
 * So the system answers for the path, and each function reports what it reports for "".
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from (Node v26.3.0 on Linux).
 * It cannot import from "harness" for the same reason, so it manages its own temporary directory.
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

const bun = "bun" in process.versions;
const windows = process.platform === "win32";

const PATH = "<path>";
// [method, arguments, outcome]. One outcome stands for the sync, callback and promise forms.
type Outcome = string | [sync: string, callback: string, promise: string];
const table: [method: string, args: unknown[], outcome: Outcome][] = [
  ["stat", [PATH], "ENOENT stat"],
  ["stat", [PATH, { throwIfNoEntry: false }], "undefined"],
  ["lstat", [PATH], "ENOENT lstat"],
  ["statfs", [PATH], "ENOENT statfs"],
  ["access", [PATH], "ENOENT access"],
  ["open", [PATH], "ENOENT open"],
  ["readFile", [PATH], "ENOENT open"],
  ["readdir", [PATH], "ENOENT scandir"],
  ["opendir", [PATH], "ENOENT opendir"],
  ["readlink", [PATH], "ENOENT readlink"],
  // fs.realpath starts from path.resolve(path). fs.promises.realpath is fs.realpath.native.
  ["realpath", [PATH], ["cwd", "cwd", "ENOENT realpath"]],
  ["mkdir", [PATH], "ENOENT mkdir"],
  ["mkdir", [PATH, { recursive: true }], "ENOENT mkdir"],
  // Node cuts the template of an empty prefix to "XXXXX":
  // https://github.com/nodejs/node/blob/v26.3.0/src/node_file.cc#L3360-L3364
  ["mkdtemp", [PATH], "EINVAL mkdtemp"],
  ["rmdir", [PATH], "ENOENT rmdir"],
  ["unlink", [PATH], "ENOENT unlink"],
  ["rm", [PATH], "ENOENT lstat"],
  ["rm", [PATH, { force: true }], "undefined"],
  ["rm", [PATH, { recursive: true }], "ENOENT lstat"],
  ["rm", [PATH, { recursive: true, force: true }], "undefined"],
  ["chmod", [PATH, 0o644], "ENOENT chmod"],
  ["chown", [PATH, 0, 0], "ENOENT chown"],
  ["lchown", [PATH, 0, 0], "ENOENT lchown"],
  ["utimes", [PATH, 0, 0], "ENOENT utime"],
  ["lutimes", [PATH, 0, 0], "ENOENT lutime"],
  ["writeFile", [PATH, "x"], "ENOENT open"],
  ["appendFile", [PATH, "x"], "ENOENT open"],
  ["rename", [PATH, "x"], "ENOENT rename"],
  ["rename", ["file", PATH], "ENOENT rename"],
  ["copyFile", [PATH, "x"], "ENOENT copyfile"],
  ["copyFile", ["file", PATH], "ENOENT copyfile"],
  ["link", [PATH, "x"], "ENOENT link"],
  ["link", ["file", PATH], "ENOENT link"],
  ["symlink", ["x", PATH], "ENOENT symlink"],
];
const label = (method: string, args: unknown[]) =>
  `${method}(${args.map(arg => (arg === PATH ? "path" : JSON.stringify(arg))).join(", ")})`;
const calls = table.map(([method, args]) => [label(method, args), method, args]);
const expected: Record<string, Outcome> = {
  ...Object.fromEntries(
    table.map(([method, args, outcome]) => [
      label(method, args),
      typeof outcome === "string" ? [outcome, outcome, outcome] : outcome,
    ]),
  ),
  "existsSync(path)": "false",
  "exists(path)": "false",
  // Node's fs.lstat and fs.promises.lstat do not read throwIfNoEntry:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L1597-L1614
  "lstatSync(path, { throwIfNoEntry: false })": "undefined",
  "realpathSync.native(path)": "ENOENT realpath",
  "realpath.native(path)": "ENOENT realpath",
};

// Runs every call with each spelling of the empty path. An empty path can act on the current
// directory, so each spelling gets a directory of its own that holds one file.
const script = `
  const fs = require("node:fs");
  const path = require("node:path");
  let here;
  const value = v => (v === here ? "cwd" : v === undefined || v === false ? String(v) : typeof v);
  const error = e => e.code + " " + e.syscall;
  function sync(fn) {
    try {
      return value(fn());
    } catch (e) {
      return error(e);
    }
  }
  // A callback form reports through its callback, after the call returns.
  function callback(fn) {
    return new Promise(resolve => {
      let returned = false;
      const done = outcome => resolve(returned ? outcome : "in the call: " + outcome);
      try {
        fn((e, v) => done(e ? error(e) : value(v)));
      } catch (e) {
        done(error(e));
      }
      returned = true;
    });
  }
  async function promise(fn) {
    try {
      return value(await fn());
    } catch (e) {
      return error(e);
    }
  }

  const spellings = {
    '""': "",
    "Buffer.alloc(0)": Buffer.alloc(0),
    "new Uint8Array(0)": new Uint8Array(0),
    'Buffer.from("x").subarray(1)': Buffer.from("x").subarray(1),
  };
  (async () => {
    const results = {};
    for (const [spelling, p] of Object.entries(spellings)) {
      const dir = path.join(process.env.FS_EMPTY_PATH_ROOT, String(Object.keys(results).length));
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "file"), "");
      process.chdir(dir);
      here = fs.realpathSync(".");

      const rows = {};
      for (const [label, method, args] of ${JSON.stringify(calls)}) {
        const call = args.map(arg => (arg === ${JSON.stringify(PATH)} ? p : arg));
        rows[label] = [
          sync(() => fs[method + "Sync"](...call)),
          await callback(cb => fs[method](...call, cb)),
          await promise(() => fs.promises[method](...call)),
        ];
      }
      rows["existsSync(path)"] = sync(() => fs.existsSync(p));
      rows["exists(path)"] = await callback(cb => fs.exists(p, found => cb(null, found)));
      rows["lstatSync(path, { throwIfNoEntry: false })"] = sync(() => fs.lstatSync(p, { throwIfNoEntry: false }));
      rows["realpathSync.native(path)"] = sync(() => fs.realpathSync.native(p));
      rows["realpath.native(path)"] = await callback(cb => fs.realpath.native(p, cb));
      results[spelling] = rows;
    }
    console.log(JSON.stringify(results));
  })();
`;

describe("a zero-length Buffer or Uint8Array path", () => {
  let root: string;
  let results: Record<string, Record<string, Outcome>>;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-empty-buffer-path-"));
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], {
      cwd: root,
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", FS_EMPTY_PATH_ROOT: root },
    });
    results = JSON.parse(stdout);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("gives the result of the empty string", () => {
    const { '""': string, ...buffers } = results;
    assert.deepStrictEqual(Object.keys(buffers), [
      "Buffer.alloc(0)",
      "new Uint8Array(0)",
      'Buffer.from("x").subarray(1)',
    ]);
    for (const [spelling, rows] of Object.entries(buffers)) {
      assert.deepStrictEqual(rows, string, spelling);
    }
  });

  test("the empty string gives the result that Node gives", () => {
    // The expected values are Node's on Linux. libuv answers some of these calls another way on
    // Windows, so there only the calls that oven-sh/bun#38052 measured with Node are compared.
    const compared = windows
      ? [
          "readdir(path)",
          'writeFile(path, "x")',
          'rm(path, {"recursive":true})',
          'rm(path, {"recursive":true,"force":true})',
        ]
      : Object.keys(expected);
    const pick = (rows: Record<string, Outcome>) => Object.fromEntries(compared.map(call => [call, rows[call]]));
    assert.deepStrictEqual(pick(results['""']), pick(expected));
  });
});

// validatePath() looks for a NUL byte with TypedArray.prototype.includes, which throws for a view
// that has no bytes to read. Such a view has length 0 too, but it is not the empty path.
describe("a detached or out-of-bounds view as a path", () => {
  const message = bun
    ? "Underlying ArrayBuffer has been detached from the view or out-of-bounds"
    : "Cannot perform %TypedArray%.prototype.includes on a detached or out-of-bounds ArrayBuffer";
  const noBytes = (err: any) => {
    assert.deepStrictEqual(
      { name: err.name, code: err.code, message: err.message },
      {
        name: "TypeError",
        code: undefined,
        message,
      },
    );
    return true;
  };

  const detached = new Uint8Array(8);
  detached.buffer.transfer();
  const resizable = new ArrayBuffer(8, { maxByteLength: 8 });
  const outOfBounds = new Uint8Array(resizable, 4);
  const inBounds = new Uint8Array(resizable);
  resizable.resize(0);

  for (const [name, view] of Object.entries({ detached, "out-of-bounds": outOfBounds })) {
    test(`${name}: every form throws the TypeError of the NUL check`, async () => {
      assert.strictEqual(view.length, 0);
      assert.throws(() => fs.statSync(view), noBytes);
      assert.throws(() => fs.statSync(view, { throwIfNoEntry: false }), noBytes);
      assert.throws(() => fs.accessSync(view), noBytes);
      assert.throws(() => fs.rmSync(view, { force: true }), noBytes);
      assert.throws(() => fs.stat(view, () => assert.fail("callback must not be invoked")), noBytes);
      await assert.rejects(fs.promises.stat(view), noBytes);
      assert.strictEqual(fs.existsSync(view), false);
    });
  }

  test("a view that is in bounds of a buffer resized to 0 is the empty path", () => {
    assert.strictEqual(inBounds.length, 0);
    assert.throws(() => fs.statSync(inBounds), { code: "ENOENT", syscall: "stat" });
    assert.strictEqual(fs.statSync(inBounds, { throwIfNoEntry: false }), undefined);
  });
});

// Results that Node and Bun do not share. Each test asserts what Node does.
describe("where Bun and Node differ for an empty path", () => {
  // validatePath() takes a string or a Uint8Array. Bun also reads the bytes of an ArrayBuffer, a
  // SharedArrayBuffer or a DataView as a path, of any length, so an empty one is the empty path.
  for (const [name, make] of Object.entries({
    ArrayBuffer: () => new ArrayBuffer(0),
    SharedArrayBuffer: () => new SharedArrayBuffer(0),
    DataView: () => new DataView(new ArrayBuffer(0)),
  })) {
    test(`Node rejects the type of ${name}`, { expectFailure: bun && "Bun reads these types as path bytes" }, () => {
      assert.throws(() => fs.statSync(make() as any), {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "path" argument must be of type string or an instance of Buffer or URL. Received an instance of ${name}`,
      });
    });
  }

  // Bun joins the path of fs.watch() to the current directory, so an empty path watches that directory.
  for (const [name, filename] of Object.entries({ '""': "", "Buffer.alloc(0)": Buffer.alloc(0) })) {
    test(`fs.watch(${name}) reports ENOENT`, { expectFailure: bun && "Bun watches the current directory" }, () => {
      assert.throws(() => fs.watch(filename).close(), { code: "ENOENT", syscall: "watch" });
    });
  }
});
