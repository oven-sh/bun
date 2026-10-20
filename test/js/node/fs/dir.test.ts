import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function noop() {}
describe("fs.opendir", () => {
  // TODO: validatePath
  // it.each([1, 0, null, undefined, function foo() {}, Symbol.for("foo")])(
  //   "throws if the path is not a string: %p",
  //   (path: any) => {
  //     expect(() => fs.opendir(path, noop)).toThrow(/The "path" argument must be of type string/);
  //   },
  // );

  it("throws if callback is not provided", () => {
    // @ts-expect-error
    expect(() => fs.opendir("foo")).toThrow(/The "callback" argument must be of type function/);
  });

  it("opendirSync on a file throws ENOTDIR with libuv's platform errno", () => {
    const file = path.join(os.tmpdir(), "opendir-enotdir-" + String(Math.random() * 100).substring(0, 6) + ".txt");
    fs.writeFileSync(file, "not a directory");
    try {
      let err: any;
      try {
        fs.opendirSync(file);
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("ENOTDIR");
      expect(err?.errno).toBe(process.platform === "win32" ? -4052 : -20);
      expect(err?.syscall).toBe("opendir");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("fs.Dir", () => {
  describe("given an empty temp directory", () => {
    let dirname: string;

    beforeAll(() => {
      const name = "dir-sync.test." + String(Math.random() * 100).substring(0, 6);
      dirname = path.join(os.tmpdir(), name);
      fs.mkdirSync(dirname);
    });

    afterAll(() => {
      fs.rmSync(dirname, { recursive: true, force: true });
    });

    describe("when an empty directory is opened", () => {
      let dir: fs.Dir;

      beforeEach(() => {
        dir = fs.opendirSync(dirname);
      });

      afterEach(() => {
        try {
          dir.closeSync();
        } catch {
          /* suppress */
        }
      });

      it("returns a Dir instance", () => {
        expect(dir).toBeDefined();
        expect(dir).toBeInstanceOf(fs.Dir);
      });

      describe("reading from the directory", () => {
        it.each([0, 1, false, "foo", {}])("throws if passed a non-function callback (%p)", badCb => {
          expect(() => dir.read(badCb as any)).toThrow(/The "callback" argument must be of type function/);
        });

        it("it can be read synchronously, even though no entries exist", () => {
          for (let i = 0; i < 5; i++) {
            const actual = dir.readSync();
            expect(actual).toBeNull();
          }
        });

        it("can be read asynchronously, even though no entries exist", async () => {
          const actual = await dir.read();
          expect(actual).toBeNull();
        });

        it("can be read asynchronously with callbacks, even though no entries exist", async () => {
          const actual = await new Promise((resolve, reject) => {
            dir.read((err, ent) => {
              if (err) reject(err);
              else resolve(ent);
            });
          });
          expect(actual).toBeNull();
        });
      }); // </reading from the directory>

      it("can be closed asynchronously", async () => {
        const actual = await dir.close();
        expect(actual).toBeUndefined();
      });

      it("can be closed asynchronously with callbacks", async () => {
        const actual = await new Promise<void>((resolve, reject) => {
          dir.close(err => {
            if (err) reject(err);
            else resolve();
          });
        });
        expect(actual).toBeUndefined();
      });

      it("can be closed synchronously", () => {
        expect(dir.closeSync()).toBeUndefined();
      });

      describe("when closed", () => {
        beforeEach(async () => {
          await dir.close();
        });

        it('attempts to close again will throw "Directory handle was closed"', () => {
          expect(() => dir.closeSync()).toThrow("Directory handle was closed");
          expect(() => dir.close()).toThrow("Directory handle was closed");
        });

        it("attempts to read will throw", () => {
          expect(() => dir.readSync()).toThrow("Directory handle was closed");
          expect(() => dir.read()).toThrow("Directory handle was closed");
        });
      }); // </when closed>
    }); // </when an empty directory is opened>
  }); // </given an empty temp directory>
}); // </fs.Dir>

describe("fs.opendir async validation", () => {
  it("does not invoke the callback synchronously", async () => {
    const dirname = path.join(os.tmpdir(), "opendir-async-" + String(Math.random() * 100).substring(0, 6));
    fs.mkdirSync(dirname);
    try {
      let sync = true;
      const { promise, resolve } = Promise.withResolvers<boolean>();
      fs.opendir(dirname, (err, dir) => {
        resolve(sync);
        dir?.close(() => {});
      });
      sync = false;
      expect(await promise).toBe(false);
    } finally {
      fs.rmSync(dirname, { recursive: true, force: true });
    }
  });

  it("reports ENOTDIR through the callback, not a synchronous throw", async () => {
    const file = path.join(os.tmpdir(), "opendir-async-file-" + String(Math.random() * 100).substring(0, 6));
    fs.writeFileSync(file, "x");
    try {
      const { promise, resolve } = Promise.withResolvers<any>();
      fs.opendir(file, err => resolve(err));
      const err = await promise;
      expect(err?.code).toBe("ENOTDIR");
      expect(err?.syscall).toBe("opendir");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("opendirSync string encoding shorthand", () => {
  it("validates a string options argument as an encoding", () => {
    const dirname = path.join(os.tmpdir(), "opendir-enc-" + String(Math.random() * 100).substring(0, 6));
    fs.mkdirSync(dirname);
    try {
      // an invalid encoding passed as the shorthand is validated like node
      // @ts-expect-error
      expect(() => fs.opendirSync(dirname, "nope")).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    } finally {
      fs.rmSync(dirname, { recursive: true, force: true });
    }
  });

  // On Windows the native readdir always emits UTF-8 names (a pre-existing
  // gap: fs.readdirSync ignores the encoding option there too), so the
  // byte-reinterpretation is only observable on POSIX.
  it.skipIf(process.platform === "win32")("applies the encoding to entry names", () => {
    const dirname = path.join(os.tmpdir(), "opendir-enc-" + String(Math.random() * 100).substring(0, 6));
    fs.mkdirSync(dirname);
    // latin1 makes the shorthand observable: the utf8 bytes of the name are
    // reinterpreted per-byte. (encoding: "buffer" dirents are a pre-existing
    // native readdir gap unrelated to the shorthand.)
    fs.writeFileSync(path.join(dirname, "na\u00efve.txt"), "x");
    try {
      const dir = fs.opendirSync(dirname, "latin1" as any);
      const entry = dir.readSync();
      expect(entry?.name).toBe(Buffer.from("na\u00efve.txt", "utf8").toString("latin1"));
      dir.closeSync();
    } finally {
      fs.rmSync(dirname, { recursive: true, force: true });
    }
  });
});

// Node's Dir implements Symbol.dispose / Symbol.asyncDispose so it composes
// with `using` / `await using`. Disposing an already-closed Dir is a no-op.
describe("Dir explicit resource management", () => {
  let dirname: string;
  beforeEach(() => {
    dirname = path.join(os.tmpdir(), "opendir-dispose-" + String(Math.random() * 100).substring(0, 6));
    fs.mkdirSync(dirname);
    fs.writeFileSync(path.join(dirname, "entry.txt"), "x");
  });
  afterEach(() => {
    fs.rmSync(dirname, { recursive: true, force: true });
  });

  it("`using` closes the directory at scope exit", () => {
    let dir!: fs.Dir;
    {
      using d = fs.opendirSync(dirname);
      dir = d;
      expect(d.readSync()?.name).toBe("entry.txt");
    }
    expect(() => dir.readSync()).toThrow(expect.objectContaining({ code: "ERR_DIR_CLOSED" }));
  });

  it("`await using` closes the directory at scope exit", async () => {
    let dir!: fs.Dir;
    {
      await using d = await fs.promises.opendir(dirname);
      dir = d;
    }
    expect(() => dir.readSync()).toThrow(expect.objectContaining({ code: "ERR_DIR_CLOSED" }));
  });

  it("disposing an already-closed Dir does not throw", async () => {
    const dir = fs.opendirSync(dirname);
    dir.closeSync();
    expect(() => dir[Symbol.dispose]()).not.toThrow();
    await expect(dir[Symbol.asyncDispose]()).resolves.toBeUndefined();
  });
});

// fs.opendir opens the directory, and the Dir reads that open directory a
// batch at a time. Renaming or removing the path afterwards changes nothing.
describe("Dir reads the directory that opendir opened", () => {
  // Descriptors of this process that are open on `dir` or on something below it.
  function descriptorsOn(dir: string) {
    let count = 0;
    for (const fd of fs.readdirSync("/proc/self/fd")) {
      try {
        const target = fs.readlinkSync("/proc/self/fd/" + fd);
        if (target === dir || target.startsWith(dir + path.sep)) count++;
      } catch {}
    }
    return count;
  }

  function swap(root: string) {
    fs.renameSync(path.join(root, "d"), path.join(root, "old"));
    fs.mkdirSync(path.join(root, "d"));
    fs.writeFileSync(path.join(root, "d", "REPLACEMENT"), "");
  }

  it.skipIf(isWindows)("readSync reads the opened directory after the path is swapped", () => {
    using root = tempDir("opendir-swap", { "d/ORIGINAL": "" });
    using dir = fs.opendirSync(path.join(String(root), "d"));
    swap(String(root));
    const names: string[] = [];
    for (let e; (e = dir.readSync());) names.push(e.name);
    expect(names).toEqual(["ORIGINAL"]);
  });

  it.skipIf(isWindows)("read reads the opened directory after the path is swapped", async () => {
    using root = tempDir("opendir-swap-async", { "d/ORIGINAL": "" });
    const { promise, resolve, reject } = Promise.withResolvers<fs.Dir>();
    fs.opendir(path.join(String(root), "d"), (err, dir) => (err ? reject(err) : resolve(dir)));
    await using dir = await promise;
    swap(String(root));
    const names: string[] = [];
    for (let e; (e = await dir.read());) names.push(e.name);
    expect(names).toEqual(["ORIGINAL"]);
  });

  it.skipIf(isWindows)("a read after the directory is removed is the end, not ENOENT", async () => {
    using root = tempDir("opendir-rm", { "a/x": "", "b/x": "" });
    using a = fs.opendirSync(path.join(String(root), "a"));
    await using b = await fs.promises.opendir(path.join(String(root), "b"));
    fs.rmSync(path.join(String(root), "a"), { recursive: true });
    fs.rmSync(path.join(String(root), "b"), { recursive: true });
    expect([a.readSync(), await b.read()]).toEqual([null, null]);
  });

  it("a read takes a part of the directory, not all of it", async () => {
    // More than any read buffer holds: glibc's readdir, which node uses, takes 32 KB (about 150 of these names).
    const count = 400;
    const filler = Buffer.alloc(191, "-").toString();
    const names = Array.from({ length: count }, (_, i) => String(i).padStart(4, "0") + filler);
    using root = tempDir("opendir-batch", {});
    const fill = (name: string) => {
      const dir = path.join(String(root), name);
      fs.mkdirSync(dir);
      for (const file of names) fs.writeFileSync(path.join(dir, file), "");
      return dir;
    };
    const empty = (dir: string) => {
      for (const file of names) fs.unlinkSync(path.join(dir, file));
    };

    const first = fill("sync");
    using sync = fs.opendirSync(first);
    expect(sync.readSync()).not.toBeNull();
    empty(first);
    let afterSync = 0;
    while (sync.readSync()) afterSync++;

    const second = fill("promise");
    await using viaPromise = await fs.promises.opendir(second, { bufferSize: 1 });
    expect(await viaPromise.read()).not.toBeNull();
    empty(second);
    let afterPromise = 0;
    while (await viaPromise.read()) afterPromise++;

    // What the OS gave for the first read is still returned. The files that
    // were never read from the OS are gone.
    expect(afterSync).toBeLessThan(count / 2);
    expect(afterPromise).toBeLessThan(count / 2);
  });

  it("reads every entry once for each bufferSize", async () => {
    const names = Array.from({ length: 70 }, (_, i) => "f" + i).sort();
    using root = tempDir("opendir-buffersize", Object.fromEntries(names.map(name => [name, ""])));
    const seen: Record<string, string[]> = {};
    for (const bufferSize of [1, 7, 32, 1000]) {
      using dir = fs.opendirSync(String(root), { bufferSize });
      const sync: string[] = [];
      for (let e; (e = dir.readSync());) sync.push(e.name);
      expect([dir.readSync(), dir.readSync()]).toEqual([null, null]);
      seen["sync " + bufferSize] = sync.sort();

      const forAwait: string[] = [];
      for await (const e of await fs.promises.opendir(String(root), { bufferSize })) forAwait.push(e.name);
      seen["for await " + bufferSize] = forAwait.sort();
    }
    for (const key in seen) expect(seen[key]).toEqual(names);
  });

  it.skipIf(!isLinux)("holds one descriptor, and every way to close releases it", async () => {
    using root = tempDir("opendir-fds", { "d/a": "", "d/b": "" });
    const d = path.join(String(root), "d");
    const held: Record<string, number[]> = {};

    const sync = fs.opendirSync(d);
    held.closeSync = [descriptorsOn(d)];
    sync.closeSync();
    held.closeSync.push(descriptorsOn(d));

    const viaPromise = await fs.promises.opendir(d);
    held.close = [descriptorsOn(d)];
    await viaPromise.close();
    held.close.push(descriptorsOn(d));

    const viaCallback = fs.opendirSync(d);
    held.closeCallback = [descriptorsOn(d)];
    const closed = Promise.withResolvers<void>();
    viaCallback.close(err => (err ? closed.reject(err) : closed.resolve()));
    await closed.promise;
    held.closeCallback.push(descriptorsOn(d));

    {
      using scoped = fs.opendirSync(d);
      held.dispose = [descriptorsOn(d)];
    }
    held.dispose.push(descriptorsOn(d));

    {
      await using scoped = await fs.promises.opendir(d);
      held.asyncDispose = [descriptorsOn(d)];
    }
    held.asyncDispose.push(descriptorsOn(d));

    const iterated = await fs.promises.opendir(d);
    held.forAwaitBreak = [descriptorsOn(d)];
    for await (const _ of iterated) break;
    held.forAwaitBreak.push(descriptorsOn(d));

    expect(() => fs.opendirSync(d, { bufferSize: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    held.invalidBufferSize = [descriptorsOn(d)];

    expect(held).toEqual({
      closeSync: [1, 0],
      close: [1, 0],
      closeCallback: [1, 0],
      dispose: [1, 0],
      asyncDispose: [1, 0],
      forAwaitBreak: [1, 0],
      invalidBufferSize: [0],
    });
  });

  it.skipIf(!isLinux)("closing a recursive Dir in the middle of the walk releases every directory", () => {
    using root = tempDir("opendir-fds-walk", { "a/x": "", "b/x": "", "c/x": "", "top": "" });
    const dir = fs.opendirSync(String(root), { recursive: true });
    while (!dir.readSync()!.isDirectory());
    // The root, and each directory that the walk has opened: at least the one it returned.
    const during = descriptorsOn(String(root));
    dir.closeSync();
    expect(during).toBeGreaterThanOrEqual(2);
    expect(descriptorsOn(String(root))).toBe(0);
  });

  it.skipIf(!isLinux)("a recursive walk holds open what the depth of the tree asks for, not its width", async () => {
    // 258 directories, 216 of them on the widest level.
    const tree: Record<string, string> = {};
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) tree[`a${i}/b${j}/c${k}/f`] = "";
    using root = tempDir("opendir-fds-wide", tree);
    const peak = { sync: 0, forAwait: 0, largeBufferSize: 0 };
    const seen = { sync: 0, forAwait: 0, largeBufferSize: 0 };

    using dir = fs.opendirSync(String(root), { recursive: true });
    while (dir.readSync()) {
      if (seen.sync++ % 8 === 0) peak.sync = Math.max(peak.sync, descriptorsOn(String(root)));
    }
    for await (const _ of await fs.promises.opendir(String(root), { recursive: true })) {
      if (seen.forAwait++ % 8 === 0) peak.forAwait = Math.max(peak.forAwait, descriptorsOn(String(root)));
    }
    // A large bufferSize gives more entries in one read. It does not open more directories.
    using large = fs.opendirSync(String(root), { recursive: true, bufferSize: 1024 });
    while (large.readSync()) {
      if (seen.largeBufferSize++ % 8 === 0) {
        peak.largeBufferSize = Math.max(peak.largeBufferSize, descriptorsOn(String(root)));
      }
    }

    expect(seen).toEqual({ sync: 474, forAwait: 474, largeBufferSize: 474 });
    expect(peak.sync).toBeLessThan(100);
    expect(peak.forAwait).toBeLessThan(100);
    expect(peak.largeBufferSize).toBeLessThan(100);
  });

  it("a Dir that is collected while open closes its directory and warns", async () => {
    using root = tempDir("opendir-gc", { "d/x": "", "empty": {} });
    const d = path.join(String(root), "d");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
         const dir = process.argv[1];
         let warnings = 0;
         process.on("warning", w => {
           if (w.message === "Closing directory handle on garbage collection") warnings++;
         });
         (function scope() {
           for (let i = 0; i < 4; i++) fs.opendirSync(dir);
           fs.opendirSync(dir).closeSync(); // a closed Dir does not warn
         })();
         (async () => {
           // Nor does a Dir whose close() is still on the work pool when its handle is collected.
           const closing = [];
           for (let i = 0; i < 16; i++) {
             closing.push(fs.opendirSync(dir).close());
             Bun.gc(true);
           }
           await Promise.all(closing);
           // The warning comes from an event-loop task after the collection.
           for (let i = 0; i < 20 && warnings < 4; i++) {
             Bun.gc(true);
             await new Promise(resolve => setImmediate(resolve));
           }
           const open = process.platform === "linux"
             ? fs.readdirSync("/proc/self/fd").filter(fd => {
                 try { return fs.readlinkSync("/proc/self/fd/" + fd) === dir; } catch { return false; }
               }).length
             : 0;
           // An index setter on Array.prototype does not take the end marker of a read.
           Object.defineProperty(Array.prototype, 0, { get() {}, set() {}, configurable: true });
           const empty = fs.opendirSync(process.argv[2]);
           const atEnd = empty.readSync();
           empty.closeSync();
           delete Array.prototype[0];
           console.log(JSON.stringify({ warnings, open, atEnd }));
         })();`,
        d,
        path.join(String(root), "empty"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // stderr has the default print of each warning.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify({ warnings: 4, open: 0, atEnd: null }));
    expect(exitCode).toBe(0);
  });

  it("a Dir made from an integer never uses it as a descriptor", () => {
    using root = tempDir("opendir-foreign", { "file": "x" });
    const fd = fs.openSync(path.join(String(root), "file"), "r");
    try {
      const invalidHandle = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
      const dir = new fs.Dir(fd as any, String(root));
      expect(() => dir.readSync()).toThrow(invalidHandle);
      expect(() => dir.closeSync()).toThrow(invalidHandle);
      // The constructor closes its handle when bufferSize is invalid. That must not hide the error, nor close this descriptor.
      expect(() => new fs.Dir(fd as any, String(root), { bufferSize: 0 })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
      expect(fs.fstatSync(fd).isFile()).toBe(true);
    } finally {
      fs.closeSync(fd);
    }
  });

  it("opens before it validates bufferSize, and accepts a uint32 only", () => {
    using root = tempDir("opendir-order", {});
    const missing = path.join(String(root), "missing");
    expect(() => fs.opendirSync(missing, { bufferSize: -1 })).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(() => fs.opendirSync(String(root), { bufferSize: 2 ** 32 })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    using dir = fs.opendirSync(String(root), { bufferSize: 2 ** 32 - 1 });
    expect(dir.readSync()).toBeNull();
  });

  it("the async iterator is Dir.prototype.entries", async () => {
    using root = tempDir("opendir-entries", { "a": "", "b": "" });
    expect(fs.Dir.prototype[Symbol.asyncIterator]).toBe((fs.Dir.prototype as any).entries);
    const dir = fs.opendirSync(String(root));
    const names: string[] = [];
    for await (const e of (dir as any).entries()) names.push(e.name);
    expect(names.sort()).toEqual(["a", "b"]);
    expect(() => dir.readSync()).toThrow(expect.objectContaining({ code: "ERR_DIR_CLOSED" }));
  });

  // A loop that starts work for each entry without a wait (fs-extra's copy) relies on this pace.
  it("for await goes back to the event loop between reads of bufferSize entries", async () => {
    // The names fit in one read of the OS, so only the pace of the Dir makes the loop wait.
    const count = 200;
    using root = tempDir("opendir-pace", Object.fromEntries(Array.from({ length: count }, (_, i) => ["f" + i, ""])));
    let seen = 0;
    let seenAtImmediate = 0;
    for await (const _ of await fs.promises.opendir(String(root), { bufferSize: 2 })) {
      if (seen++ === 0) setImmediate(() => (seenAtImmediate = seen));
    }
    expect(seen).toBe(count);
    // The immediate ran while the loop waited for a later read.
    expect(seenAtImmediate).toBeGreaterThan(0);
    expect(seenAtImmediate).toBeLessThan(count);
  });

  it("validates options as node's getOptions does", () => {
    using root = tempDir("opendir-options", { "a": "" });
    // An empty encoding is the default. A function means no options.
    for (const options of ["", { encoding: "" }, () => {}]) {
      using dir = fs.opendirSync(String(root), options as any);
      expect(dir.readSync()!.name).toBe("a");
    }
    expect(() => fs.opendirSync(String(root), 42 as any)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "options" argument must be one of type string or object. Received type number (42)',
      }),
    );
  });

  it("a function as the options of promises.opendir is not the callback", async () => {
    using root = tempDir("opendir-options-promise", { "a": "" });
    const calledBack = Promise.withResolvers<string>();
    const opened = fs.promises.opendir(String(root), (() => calledBack.resolve("called as the callback")) as any);
    const result = await Promise.race([opened, calledBack.promise]);
    expect(result).toBeInstanceOf(fs.Dir);
    await (result as fs.Dir).close();
  });

  it("a file: URL gives Dir.path and the error the path that it names", async () => {
    using root = tempDir("opendir-url", { "sp ace/entry": "" });
    const d = path.join(String(root), "sp ace");
    using sync = fs.opendirSync(pathToFileURL(d));
    await using viaPromise = await fs.promises.opendir(pathToFileURL(d));
    expect([sync.path, viaPromise.path]).toEqual([d, d]);
    const missing = path.join(d, "missing");
    expect(await fs.promises.opendir(pathToFileURL(missing)).catch(err => err)).toMatchObject({
      code: "ENOENT",
      syscall: "opendir",
      path: missing,
    });
  });
});

// With `recursive`, a directory is read only after its entry was returned,
// and it is opened relative to its parent's open directory.
describe("Dir recursive walk", () => {
  const relativeTo = (root: string) => (e: fs.Dirent) => path.relative(root, path.join(e.parentPath, e.name));

  it("reads a directory after its entry is returned", async () => {
    using root = tempDir("opendir-lazy", { "sync/sub/first": "", "sync/z": "", "async/sub/first": "", "async/z": "" });

    const syncRoot = path.join(String(root), "sync");
    using dir = fs.opendirSync(syncRoot, { recursive: true });
    const sync = [dir.readSync()!.name];
    fs.writeFileSync(path.join(syncRoot, "sub", "ADDED"), "");
    for (let e; (e = dir.readSync());) sync.push(e.name);

    const asyncRoot = path.join(String(root), "async");
    const forAwait: string[] = [];
    for await (const e of await fs.promises.opendir(asyncRoot, { recursive: true })) {
      forAwait.push(e.name);
      if (e.name === "sub") fs.writeFileSync(path.join(asyncRoot, "sub", "ADDED"), "");
    }

    const expected = ["ADDED", "first", "sub", "z"];
    expect({ sync: sync.sort(), forAwait: forAwait.sort() }).toEqual({ sync: expected, forAwait: expected });
  });

  it("reports parentPath as node does for each spelling of the root", () => {
    using root = tempDir("opendir-parentpath", { "t/a/b/f": "", "t/top": "" });
    const t = path.join(String(root), "t");
    const seen: Record<string, string[]> = {};
    const dotdot = t + path.sep + "a" + path.sep + "..";
    for (const spelling of [t, t + path.sep, dotdot]) {
      using dir = fs.opendirSync(spelling, { recursive: true, bufferSize: 1 });
      const entries: string[] = [];
      for (let e; (e = dir.readSync());) entries.push(e.parentPath + "|" + e.name);
      seen[spelling] = entries.sort();
    }
    // The root is reported as it was given. A nested directory is path.join(parentPath, name).
    const nested = [path.join(t, "a", "b") + "|f", path.join(t, "a") + "|b"];
    expect(seen).toEqual({
      [t]: [...nested, t + "|a", t + "|top"].sort(),
      [t + path.sep]: [...nested, t + path.sep + "|a", t + path.sep + "|top"].sort(),
      [dotdot]: [...nested, dotdot + "|a", dotdot + "|top"].sort(),
    });

    // The encoding is for the names only. (On Windows the names of a Dirent are not encoded at all.)
    using hex = fs.opendirSync(t, { encoding: "hex" });
    const entry = hex.readSync()!;
    expect(entry.parentPath).toBe(t);
    if (!isWindows) expect(["a", "top"]).toContain(Buffer.from(entry.name, "hex").toString());
  });

  // Until the entries for this encoding are Dirents, a name is the only place for the directory of an entry.
  it("gives the path from the root for each entry of a walk with encoding 'buffer'", () => {
    using root = tempDir("opendir-buffer-walk", { "a/b/f": "", "top": "" });
    using dir = fs.opendirSync(String(root), { recursive: true, encoding: "buffer" });
    const entries: string[] = [];
    for (let e: any; (e = dir.readSync());) {
      entries.push(
        Buffer.isBuffer(e) ? e.toString() : path.relative(String(root), path.join(e.parentPath, String(e.name))),
      );
    }
    expect(entries.sort()).toEqual(["a", path.join("a", "b"), path.join("a", "b", "f"), "top"]);
  });

  // `a/b` is opened after the rename. node opens a child by its path, so there this walk stops with ENOENT.
  it.skipIf(isWindows)("keeps to the tree it opened when the root is renamed", () => {
    using root = tempDir("opendir-walk-rename", { "t/a/b/inner": "", "t/top": "" });
    const t = path.join(String(root), "t");
    using dir = fs.opendirSync(t, { recursive: true, bufferSize: 1 });
    const names = [dir.readSync()!.name];
    fs.renameSync(t, path.join(String(root), "moved"));
    for (let e; (e = dir.readSync());) names.push(e.name);
    expect(names.sort()).toEqual(["a", "b", "inner", "top"]);
  });

  it("does not enter a symbolic link to a directory", () => {
    using root = tempDir("opendir-symlink", { "real/inside": "", "file": "" });
    fs.symlinkSync(path.join(String(root), "real"), path.join(String(root), "link"), "dir");
    using dir = fs.opendirSync(String(root), { recursive: true });
    const entries: string[] = [];
    for (let e; (e = dir.readSync());) entries.push(relativeTo(String(root))(e));
    expect(entries.sort()).toEqual(["file", "link", "real", path.join("real", "inside")]);
  });

  // node joins the child's path as a string, which loses these bytes: there this walk is ENOENT.
  it.skipIf(!isLinux)("enters a directory whose name is not valid UTF-8", () => {
    using root = tempDir("opendir-bytes", {});
    const name = Buffer.from([0x64, 0xff]);
    const rootBytes = Buffer.from(String(root) + path.sep);
    fs.mkdirSync(Buffer.concat([rootBytes, name]));
    fs.writeFileSync(Buffer.concat([rootBytes, name, Buffer.from("/inner")]), "");
    using dir = fs.opendirSync(String(root), { recursive: true });
    const names: string[] = [];
    for (let e; (e = dir.readSync());) names.push(e.name);
    expect(names.sort()).toEqual(["d\ufffd", "inner"]);
  });

  // Mode bits do not stop root, so the child runs as another user when the tests run as root.
  it.skipIf(isWindows)("a directory that cannot be opened fails the read that reaches it, and no other", async () => {
    using root = tempDir("opendir-unreadable", {});
    using unprivileged = unprivilegedSpawnOptions(String(root));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
         const path = require("node:path");
         const root = path.join(process.argv[1], "tree");
         fs.mkdirSync(path.join(root, "a", "b", "locked"), { recursive: true });
         fs.writeFileSync(path.join(root, "top"), "");
         fs.writeFileSync(path.join(root, "a", "b", "locked", "x"), "");
         const locked = path.join(root, "a", "b", "locked");
         fs.chmodSync(locked, 0o000);
         const shape = e => [e.code, e.syscall, path.relative(root, e.path)].join(" ");
         const walkOf = (from, bufferSize) => {
           const dir = fs.opendirSync(from, { recursive: true, bufferSize });
           const walk = [];
           for (;;) {
             try {
               const e = dir.readSync();
               if (e === null) break;
               walk.push(path.relative(from, path.join(e.parentPath, e.name)));
             } catch (e) {
               walk.push("threw " + [e.code, e.syscall, path.relative(from, e.path)].join(" "));
             }
           }
           dir.closeSync();
           return walk;
         };
         (async () => {
           const out = {};
           {
             const dir = fs.opendirSync(root, { recursive: true });
             out.firstReadSync = dir.readSync() !== null;
             dir.closeSync();
           }
           {
             let seen = 0;
             for await (const _ of await fs.promises.opendir(root, { recursive: true })) { seen++; break; }
             out.forAwaitBreak = seen;
           }
           for (const bufferSize of [1, 32]) out["walk bufferSize " + bufferSize] = walkOf(root, bufferSize).sort();
           {
             const walk = [];
             try {
               for await (const e of await fs.promises.opendir(root, { recursive: true })) walk.push(e.name);
             } catch (e) {
               walk.push("threw " + shape(e));
             }
             out.forAwait = walk.at(-1);
           }
           try {
             fs.opendirSync(locked).closeSync();
             out.openLocked = "opened";
           } catch (e) {
             out.openLocked = shape(e);
           }
           out.openLockedCallback = await new Promise(resolve =>
             fs.opendir(locked, err => resolve(err ? shape(err) : "opened")),
           );
           fs.chmodSync(locked, 0o755);

           // The directory that fails comes after an entry of the same read: that read gives the entry, the next one the error.
           const pair = path.join(process.argv[1], "pair");
           for (const name of ["one", "two"]) {
             fs.mkdirSync(path.join(pair, "p", name), { recursive: true });
             fs.writeFileSync(path.join(pair, "p", name, "in"), "");
           }
           const [first, second] = fs.readdirSync(path.join(pair, "p"));
           fs.chmodSync(path.join(pair, "p", second), 0o000);
           out.afterAnEntry = walkOf(pair, 32).map(step => step.replace(first, "FIRST").replace(second, "SECOND"));
           fs.chmodSync(path.join(pair, "p", second), 0o755);
           console.log(JSON.stringify(out));
         })();`,
        String(root),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lockedPath = path.join("a", "b", "locked");
    const walk = ["a", path.join("a", "b"), "threw EACCES opendir " + lockedPath, "top"].sort();
    expect({ out: stdout.trim() === "" ? stderr : JSON.parse(stdout), exitCode }).toEqual({
      out: {
        firstReadSync: true,
        forAwaitBreak: 1,
        "walk bufferSize 1": walk,
        "walk bufferSize 32": walk,
        forAwait: "threw EACCES opendir " + lockedPath,
        openLocked: "EACCES opendir " + lockedPath,
        openLockedCallback: "EACCES opendir " + lockedPath,
        afterAnEntry: [
          "p",
          path.join("p", "FIRST"),
          "threw EACCES opendir " + path.join("p", "SECOND"),
          path.join("p", "FIRST", "in"),
        ],
      },
      exitCode: 0,
    });
  });
});
