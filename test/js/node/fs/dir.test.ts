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
      fs.rmdirSync(dirname, { recursive: true });
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
