import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
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
