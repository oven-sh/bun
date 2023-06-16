import fs from "fs";
import path from "path";
import { createTest } from "node-harness";
import { tempDirWithFiles, bunRun, bunRunAsScript } from "harness";
import { pathToFileURL } from "bun";

const { describe, expect, test, createDoneDotAll } = createTest(import.meta.path);
// Because macOS (and possibly other operating systems) can return a watcher
// before it is actually watching, we need to repeat the operation to avoid
// a race condition.
function repeat(fn) {
  setTimeout(fn, 100);
  const interval = setInterval(fn, 500);
  return interval;
}
const encodingFileName = `新建文夹件.txt`;
const testDir = tempDirWithFiles("watch", {
  "watch.txt": "hello",
  "relative.txt": "hello",
  "abort.txt": "hello",
  "url.txt": "hello",
  [encodingFileName]: "hello",
});

describe("fs.watch", () => {
  // TODO: sometimes Subprocess never ends and test hangs
  test.skip("non-persistent watcher should not block the event loop", done => {
    try {
      // https://github.com/joyent/node/issues/2293 - non-persistent watcher should not block the event loop
      bunRun(path.join(import.meta.dir, "fixtures", "persistent.js"));
      done();
    } catch (e) {
      done(e);
    }
  });
  // TODO: sometimes Subprocess never ends and test hangs
  test.skip("should work with relative files", done => {
    try {
      bunRunAsScript(testDir, path.join(import.meta.dir, "fixtures", "relative.js"));
      done();
    } catch (e) {
      done(e);
    }
  });

  test("add file/folder to folder", done => {
    let count = 0;
    const root = path.join(testDir, "add-directory");
    try {
      fs.mkdirSync(root);
    } catch {}
    const watcher = fs.watch(root, { signal: AbortSignal.timeout(3000) });
    watcher.on("change", (event, filename) => {
      count++;
      try {
        expect(event).toBe("rename");
        expect(["new-file.txt", "new-folder.txt"]).toContain(filename);
        if (count >= 2) done();
      } catch (e) {
        done(e);
      }
      watcher.close();
    });
    watcher.on("error", () => done(err));
    watcher.on("close", () => {
      clearInterval(interval);
    });

    const interval = repeat(() => {
      fs.writeFileSync(path.join(root, "new-file.txt"), "hello");
      fs.mkdirSync(path.join(root, "new-folder.txt"));
      fs.rmdirSync(path.join(root, "new-folder.txt"));
    });
  }, 4000);

  test("add file/folder to subfolder", done => {
    let count = 0;
    const root = path.join(testDir, "add-directory");
    try {
      fs.mkdirSync(root);
    } catch {}
    const subfolder = path.join(root, "subfolder");
    fs.mkdirSync(subfolder);
    const watcher = fs.watch(root, { recursive: true, signal: AbortSignal.timeout(3000) });
    watcher.on("change", (event, filename) => {
      count++;
      try {
        expect(event).toBe("rename");
        expect(["new-file.txt", "new-folder.txt"]).toContain(path.basename(filename));
        if (count >= 2) done();
      } catch (e) {
        done(e);
      }
      watcher.close();
    });
    watcher.on("error", () => done(err));
    watcher.on("close", () => {
      clearInterval(interval);
    });

    const interval = repeat(() => {
      fs.writeFileSync(path.join(subfolder, "new-file.txt"), "hello");
      fs.mkdirSync(path.join(subfolder, "new-folder.txt"));
      fs.rmdirSync(path.join(subfolder, "new-folder.txt"));
    });
  }, 4000);
  test("should emit event when file is deleted", done => {
    const testsubdir = tempDirWithFiles("subdir", {
      "deleted.txt": "hello",
    });
    const filepath = path.join(testsubdir, "deleted.txt");
    const watcher = fs.watch(testsubdir, function (event, filename) {
      try {
        expect(event).toBe("rename");
        expect(filename).toBe("deleted.txt");
        done();
      } catch (e) {
        done(e);
      } finally {
        clearInterval(interval);
        watcher.close();
      }
    });

    const interval = repeat(() => {
      fs.rmSync(filepath, { force: true });
      const fd = fs.openSync(filepath, "w");
      fs.closeSync(fd);
    });
  }, 4000);

  test("should emit 'change' event when file is modified", done => {
    const filepath = path.join(testDir, "watch.txt");

    const watcher = fs.watch(filepath);
    watcher.on("change", function (event, filename) {
      try {
        expect(event).toBe("change");
        expect(filename).toBe("watch.txt");
        done();
      } catch (e) {
        done(e);
      } finally {
        clearInterval(interval);
        watcher.close();
      }
    });

    const interval = repeat(() => {
      fs.writeFileSync(filepath, "world");
    });
  }, 4000);

  test("Signal aborted after creating the watcher", done => {
    const filepath = path.join(testDir, "abort.txt");

    const ac = new AbortController();
    const watcher = fs.watch(filepath, { signal: ac.signal });
    watcher.once("close", () => done());
    setImmediate(() => ac.abort());
  }, 1000);

  test("Signal aborted before creating the watcher", done => {
    const filepath = path.join(testDir, "abort.txt");

    const signal = AbortSignal.abort();
    const watcher = fs.watch(filepath, { signal });
    watcher.once("close", () => done());
  }, 1000);

  test("should error on invalid path", done => {
    try {
      fs.watch(path.join(testDir, "404.txt"));
      done(new Error("should not reach here"));
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ENOENT");
      expect(err.syscall).toBe("watch");
      done();
    }
  });

  const encodings = ["utf8", "buffer", "hex", "ascii", "utf-8", "base64"];
  const brokenEncodings = ["utf16le", "ucs2", "ucs-2", "latin1", "binary"];

  test.todo(`should work with encodings ${brokenEncodings.join(", ")}`, done => {
    done(new Error("TODO: implement"));
  });
  test(`should work with encodings ${encodings.join(", ")}`, done => {
    const createDone = createDoneDotAll(err => {
      watchers.forEach(w => w.close());
      clearInterval(interval);
      done(err);
    });

    const watchers = [];
    const filepath = path.join(testDir, encodingFileName);

    encodings.forEach(name => {
      const encodeDone = createDone();
      const encoded_filename =
        name !== "buffer" ? Buffer.from(encodingFileName, "utf8").toString(name) : Buffer.from(encodingFileName);
      watchers.push(
        fs.watch(filepath, { encoding: name }, (event, filename) => {
          try {
            expect(event).toBe("change");

            if (name !== "buffer") {
              expect(filename).toBe(encoded_filename);
            } else {
              expect(filename).toBeInstanceOf(Buffer);
              expect(filename.toString("utf8")).toBe(encodingFileName);
            }

            encodeDone();
          } catch (e) {
            encodeDone(e);
          }
        }),
      );
    });

    const interval = repeat(() => {
      fs.writeFileSync(filepath, "world");
    });
  }, 30000);

  test.todo(
    "should work with url",
    done => {
      const filepath = path.join(testDir, "url.txt");
      try {
        const watcher = fs.watch(pathToFileURL(filepath));
        watcher.on("change", function (event, filename) {
          try {
            expect(event).toBe("change");
            expect(filename).toBe("watch.txt");
            done();
          } catch (e) {
            done(e);
          } finally {
            clearInterval(interval);
            watcher.close();
          }
        });

        const interval = repeat(() => {
          fs.writeFileSync(filepath, "world");
        });
      } catch (e) {
        done(e);
      }
    },
    4000,
  );
  test.todo(
    "should close when root is deleted",
    done => {
      const root = path.join(testDir, "watched-directory");
      try {
        fs.mkdirSync(root);
      } catch {}
      const watcher = fs.watch(root, { signal: AbortSignal.timeout(3000) });
      watcher.on("close", () => done());
      watcher.on("error", () => done(err));

      setTimeout(() => {
        fs.mkdirSync(root);
      }, 1000);
    },
    4000,
  );
});
