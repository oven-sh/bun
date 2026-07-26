import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
          expect(() => dir.read(badCb)).toThrow(/The "callback" argument must be of type function/);
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
      const dir = fs.opendirSync(dirname, "latin1");
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

// Node opens the directory at opendir time and iterates that fd; the handle
// pins the inode, so renaming or removing the path between opendir and read
// has no effect on what is iterated.
describe.skipIf(!isPosix)("Dir pins the directory at open time", () => {
  it("readSync sees entries from the opened inode after the path is rename-swapped", () => {
    using root = tempDir("opendir-swap", { "d/ORIGINAL": "" });
    using dir = fs.opendirSync(path.join(String(root), "d"));
    fs.renameSync(path.join(String(root), "d"), path.join(String(root), "old"));
    fs.mkdirSync(path.join(String(root), "d"));
    fs.writeFileSync(path.join(String(root), "d", "REPLACEMENT"), "");
    const names: string[] = [];
    for (let e; (e = dir.readSync()); ) names.push(e.name);
    expect(names).toEqual(["ORIGINAL"]);
  });

  it("async opendir + read sees entries from the opened inode after the path is rename-swapped", async () => {
    using root = tempDir("opendir-swap-async", { "d/ORIGINAL": "" });
    const { promise, resolve, reject } = Promise.withResolvers<fs.Dir>();
    fs.opendir(path.join(String(root), "d"), (err, dir) => (err ? reject(err) : resolve(dir)));
    await using dir = await promise;
    fs.renameSync(path.join(String(root), "d"), path.join(String(root), "old"));
    fs.mkdirSync(path.join(String(root), "d"));
    fs.writeFileSync(path.join(String(root), "d", "REPLACEMENT"), "");
    const names: string[] = [];
    for (let e; (e = await dir.read()); ) names.push(e.name);
    expect(names).toEqual(["ORIGINAL"]);
  });

  it("reading after the directory is removed returns end-of-stream, not ENOENT", () => {
    using root = tempDir("opendir-rm", { "d/ORIGINAL": "" });
    using dir = fs.opendirSync(path.join(String(root), "d"));
    fs.rmSync(path.join(String(root), "d"), { recursive: true });
    expect(dir.readSync()).toBeNull();
  });

  // /proc/self/fd is the simplest fd census; skip elsewhere.
  it.skipIf(!isLinux)("opendirSync holds one fd per handle and close releases it", () => {
    using root = tempDir("opendir-fds", { "d/x": "" });
    const count = () => fs.readdirSync("/proc/self/fd").length;
    const before = count();
    const dir = fs.opendirSync(path.join(String(root), "d"));
    expect(count() - before).toBe(1);
    dir.closeSync();
    expect(count() - before).toBe(0);
  });

  it("an unclosed Dir closes its fd and warns when garbage collected", async () => {
    using root = tempDir("opendir-gc", { "d/x": "" });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
         let warnings = 0;
         process.on("warning", w => {
           if (w.message === "Closing directory handle on garbage collection") warnings++;
         });
         (function scope() {
           for (let i = 0; i < 4; i++) fs.opendirSync(process.argv[1]);
           fs.opendirSync(process.argv[1]).closeSync(); // explicit close must not warn
         })();
         (async () => {
           // FinalizationRegistry callbacks run on a task, not a microtask.
           for (let i = 0; i < 10 && warnings < 4; i++) {
             Bun.gc(true);
             await new Promise(r => setImmediate(r));
           }
           const leaked = process.platform === "linux"
             ? fs.readdirSync("/proc/self/fd").filter(f => {
                 try { return fs.readlinkSync("/proc/self/fd/" + f) === process.argv[1]; } catch { return false; }
               }).length
             : 0;
           console.log(JSON.stringify({ warnings, leaked }));
         })();`,
        path.join(String(root), "d"),
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ warnings: 4, leaked: 0 });
    expect(exitCode).toBe(0);
  });
});
