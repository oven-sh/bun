/**
 * An fs.Dirent kept its entry type under a private name, so no own key carried
 * it. assert.deepStrictEqual() passed for a file entry and a directory entry
 * of the same name, and a copy of the own keys answered false from isFile(),
 * isDirectory() and the other five methods. Node stores the type in an own
 * enumerable Symbol("type") property, and the methods read that key from the
 * receiver:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L166-L200
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary
 * directory.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { isDeepStrictEqual, promisify } from "node:util";

const { UV_DIRENT_FILE, UV_DIRENT_DIR, UV_DIRENT_LINK } = fs.constants as any;
// @types/node does not declare the constructor.
const Dirent: any = fs.Dirent;
const kType = Object.getOwnPropertySymbols(new Dirent("x", UV_DIRENT_FILE, "/dir")).find(
  symbol => symbol.description === "type",
)!;
const methods = ["isFile", "isDirectory", "isSymbolicLink", "isBlockDevice", "isCharacterDevice", "isFIFO", "isSocket"];
const answers = (entry: any) => methods.filter(method => entry[method]()).join();
const first = async (entries: AsyncIterable<any>) => {
  for await (const entry of entries) return entry;
};

function copies(entry: any) {
  const prototype = Object.getPrototypeOf(entry);
  const keyByKey = Object.create(prototype);
  for (const key of Reflect.ownKeys(entry)) keyByKey[key] = entry[key];
  return [
    Object.assign(Object.create(prototype), entry),
    Object.setPrototypeOf({ ...entry }, prototype),
    keyByKey,
    Object.create(prototype, Object.getOwnPropertyDescriptors(entry)),
  ];
}

const Subclass: any = class extends Dirent {};
function NewTarget() {}
NewTarget.prototype = Object.create(Dirent.prototype);

// Each producer returns the Dirent of "x", the only entry of `dir`.
const withFileTypes = { withFileTypes: true } as const;
const recursive = { withFileTypes: true, recursive: true } as const;
const producers: [string, (dir: string, type: number) => any][] = [
  ["new Dirent", (dir, type) => new Dirent("x", type, dir)],
  ["a subclass", (dir, type) => new Subclass("x", type, dir)],
  ["Reflect.construct", (dir, type) => Reflect.construct(Dirent, ["x", type, dir], NewTarget)],
  ["readdirSync", dir => fs.readdirSync(dir, withFileTypes)[0]],
  ["readdirSync recursive", dir => fs.readdirSync(dir, recursive)[0]],
  ["readdir callback", async dir => (await promisify(fs.readdir as any)(dir, withFileTypes))[0]],
  ["readdir callback recursive", async dir => (await promisify(fs.readdir as any)(dir, recursive))[0]],
  ["promises.readdir", async dir => (await fs.promises.readdir(dir, withFileTypes))[0]],
  ["promises.readdir recursive", async dir => (await fs.promises.readdir(dir, recursive))[0]],
  [
    "opendirSync readSync",
    dir => {
      const handle = fs.opendirSync(dir);
      try {
        return handle.readSync();
      } finally {
        handle.closeSync();
      }
    },
  ],
  [
    "opendir read",
    async dir => {
      const handle = await fs.promises.opendir(dir);
      try {
        return await handle.read();
      } finally {
        await handle.close();
      }
    },
  ],
  ["opendir async iterator", async dir => first(await fs.promises.opendir(dir))],
  ["globSync", dir => fs.globSync("*", { cwd: dir, ...withFileTypes })[0]],
  ["glob callback", async dir => (await promisify(fs.glob as any)("*", { cwd: dir, ...withFileTypes }))[0]],
  ["promises.glob", dir => first(fs.promises.glob("*", { cwd: dir, ...withFileTypes }))],
];

describe("the entry type of an fs.Dirent", () => {
  let root: string;
  const emptyDir = () => fs.mkdtempSync(path.join(root, "case-"));
  const dirWithFile = () => {
    const dir = emptyDir();
    fs.writeFileSync(path.join(dir, "x"), "");
    return dir;
  };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-dirent-type-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [producer, produce] of producers) {
    test(`from ${producer} is an own key that comparisons and copies see`, async () => {
      const dir = dirWithFile();
      const file = await produce(dir, UV_DIRENT_FILE);
      const sameFile = await produce(dir, UV_DIRENT_FILE);
      fs.rmSync(path.join(dir, "x"));
      fs.mkdirSync(path.join(dir, "x"));
      const folder = await produce(dir, UV_DIRENT_DIR);

      for (const [entry, type, answer] of [
        [file, UV_DIRENT_FILE, "isFile"],
        [folder, UV_DIRENT_DIR, "isDirectory"],
      ]) {
        assert.strictEqual(entry.name, "x");
        assert.strictEqual(answers(entry), answer);
        assert.deepStrictEqual(Object.getOwnPropertySymbols(entry), [kType]);
        assert.deepStrictEqual(Object.getOwnPropertyDescriptor(entry, kType), {
          value: type,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        assert.deepStrictEqual(
          copies(entry).map(copy => answers(copy)),
          [answer, answer, answer, answer],
        );
      }

      assert.deepStrictEqual(file, sameFile);
      assert.strictEqual(isDeepStrictEqual(file, sameFile), true);
      assert.notDeepStrictEqual(file, folder);
      assert.strictEqual(isDeepStrictEqual(file, folder), false);
    });
  }

  test("is null on the entry that glob builds from a stat", async () => {
    const options = { cwd: dirWithFile(), ...withFileTypes };
    const entries = [
      fs.globSync("x", options)[0],
      (await promisify(fs.glob as any)("x", options))[0],
      await first(fs.promises.glob("x", options)),
    ];
    for (const entry of entries) {
      assert.strictEqual(answers(entry), "isFile");
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(entry, kType), {
        value: null,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  });

  test("is read from the receiver by every is* method", () => {
    const dir = dirWithFile();
    for (const make of [
      () => new Dirent("x", UV_DIRENT_FILE, dir),
      () => fs.readdirSync(dir, withFileTypes)[0] as any,
    ]) {
      const written = make();
      written[kType] = UV_DIRENT_DIR;
      assert.strictEqual(answers(written), "isDirectory");

      const deleted = make();
      delete deleted[kType];
      assert.strictEqual(answers(deleted), "");

      const accessor = make();
      Object.defineProperty(accessor, kType, { get: () => UV_DIRENT_LINK });
      assert.strictEqual(answers(accessor), "isSymbolicLink");

      assert.strictEqual(answers(new Proxy(make(), {})), "isFile");
      assert.strictEqual(answers(Object.create(make())), "isFile");
    }
  });

  test("propagates an exception from a getter or a Proxy trap", () => {
    const accessor = new Dirent("x", UV_DIRENT_FILE, "/dir");
    Object.defineProperty(accessor, kType, {
      get() {
        throw new RangeError("from the getter");
      },
    });
    const proxy = new Proxy(new Dirent("x", UV_DIRENT_FILE, "/dir"), {
      get(target, key, receiver) {
        if (key === kType) throw new RangeError("from the trap");
        return Reflect.get(target, key, receiver);
      },
    });
    for (const method of methods) {
      assert.throws(() => accessor[method](), { name: "RangeError", message: "from the getter" });
      assert.throws(() => proxy[method](), { name: "RangeError", message: "from the trap" });
    }
  });

  test("answers false when it is not strictly equal to the constant", () => {
    assert.strictEqual(answers(new Dirent("x", UV_DIRENT_DIR, "/dir")), "isDirectory");
    for (const type of [
      UV_DIRENT_DIR + 2 ** 32,
      UV_DIRENT_DIR + 0.5,
      String(UV_DIRENT_DIR),
      BigInt(UV_DIRENT_DIR),
      { valueOf: () => UV_DIRENT_DIR },
      null,
      undefined,
    ]) {
      assert.strictEqual(answers(new Dirent("x", type, "/dir")), "");
    }
  });

  test("answers true for an integer that the engine boxes as a double", () => {
    // A Float64Array read is a double-boxed number in JavaScriptCore.
    const boxed = new Float64Array([UV_DIRENT_DIR])[0];
    assert.strictEqual(answers(new Dirent("x", boxed, "/dir")), "isDirectory");

    const written = new Dirent("x", UV_DIRENT_FILE, "/dir");
    written[kType] = boxed;
    assert.strictEqual(answers(written), "isDirectory");
    assert.strictEqual(answers(Object.assign(Object.create(Dirent.prototype), written)), "isDirectory");
  });

  test("keeps one symbol while the process lives", () => {
    // This module holds the symbol in `kType`, so a new process asks the question.
    const script = `
      const fs = require("node:fs");
      const entry = new fs.Dirent("x", 1, "/dir");
      const seen = new WeakSet();
      (() => {
        seen.add(Object.getOwnPropertySymbols(entry)[0]);
      })();
      (async () => {
        for (let i = 0; i < 3; i++) {
          globalThis.gc();
          await new Promise(setImmediate);
        }
        console.log(seen.has(Object.getOwnPropertySymbols(entry)[0]));
      })();
    `;
    const { stdout, status } = spawnSync(process.execPath, ["--expose-gc", "-e", script], {
      encoding: "utf8",
      // A debug build of Bun logs unless this is set. Node ignores it.
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    });
    assert.strictEqual(stdout.trim(), "true");
    assert.strictEqual(status, 0);
  });

  test("is seen by Bun.deepEquals", { skip: typeof Bun === "undefined" }, () => {
    const file = new Dirent("x", UV_DIRENT_FILE, "/dir");
    const folder = new Dirent("x", UV_DIRENT_DIR, "/dir");
    assert.strictEqual(Bun.deepEquals(file, new Dirent("x", UV_DIRENT_FILE, "/dir")), true);
    assert.strictEqual(Bun.deepEquals(file, folder), false);
    assert.strictEqual(Bun.deepEquals(file, folder, true), false);
  });
});
