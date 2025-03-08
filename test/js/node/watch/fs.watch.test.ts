import { file, pathToFileURL } from "bun";
import { bunRun, bunRunAsScript, isWindows, tempDirWithFiles } from "harness";
import fs, { FSWatcher } from "node:fs";
import path from "path";

import { describe, expect, mock, test } from "bun:test";
// Because macOS (and possibly other operating systems) can return a watcher
// before it is actually watching, we need to repeat the operation to avoid
// a race condition.
function repeat(fn: any) {
  const interval = setInterval(fn, 20);
  return interval;
}
const encodingFileName = `新建文夹件.txt`;
const testDir = tempDirWithFiles("watch", {
  "watch.txt": "hello",
  "relative.txt": "hello",
  "abort.txt": "hello",
  "url.txt": "hello",
  "close.txt": "hello",
  "close-close.txt": "hello",
  "sym-sync.txt": "hello",
  "sym.txt": "hello",
  [encodingFileName]: "hello",
});

describe("fs.watch", () => {
  test("non-persistent watcher should not block the event loop", done => {
    try {
      // https://github.com/joyent/node/issues/2293 - non-persistent watcher should not block the event loop
      bunRun(path.join(import.meta.dir, "fixtures", "persistent.js"));
      done();
    } catch (e: any) {
      done(e);
    }
  });

  test("watcher should close and not block the event loop", done => {
    try {
      bunRun(path.join(import.meta.dir, "fixtures", "close.js"));
      done();
    } catch (e: any) {
      done(e);
    }
  });

  test("unref watcher should not block the event loop", done => {
    try {
      bunRun(path.join(import.meta.dir, "fixtures", "unref.js"));
      done();
    } catch (e: any) {
      done(e);
    }
  });

  test("should work with relative files", done => {
    try {
      bunRunAsScript(testDir, path.join(import.meta.dir, "fixtures", "relative.js"));
      done();
    } catch (e: any) {
      done(e);
    }
  });

  test("should work with relative dirs", done => {
    try {
      const myrelativedir = path.join(testDir, "myrelativedir");
      try {
        fs.mkdirSync(myrelativedir);
      } catch {}
      fs.writeFileSync(path.join(myrelativedir, "relative.txt"), "hello");
      bunRunAsScript(testDir, path.join(import.meta.dir, "fixtures", "relative_dir.js"));
      done();
    } catch (e: any) {
      done(e);
    }
  });
  test("add file/folder to folder", done => {
    let count = 0;
    const root = path.join(testDir, "add-directory");
    try {
      fs.mkdirSync(root);
    } catch {}
    let err: Error | undefined = undefined;
    const watcher = fs.watch(root, { signal: AbortSignal.timeout(3000) });
    watcher.on("change", (event, filename) => {
      count++;
      try {
        expect(["rename", "change"]).toContain(event);
        expect(["new-file.txt", "new-folder.txt"]).toContain(filename);
        if (count >= 2) {
          watcher.close();
        }
      } catch (e: any) {
        err = e;
        watcher.close();
      }
    });

    watcher.on("error", e => (err = e));
    watcher.on("close", () => {
      clearInterval(interval);
      done(err);
    });

    const interval = repeat(() => {
      fs.writeFileSync(path.join(root, "new-file.txt"), "hello");
      fs.mkdirSync(path.join(root, "new-folder.txt"));
      fs.rmdirSync(path.join(root, "new-folder.txt"));
    });
  });

  test("custom signal", async () => {
    const root = path.join(testDir, "custom-signal");
    try {
      fs.mkdirSync(root);
    } catch {}
    const controller = new AbortController();
    const watcher = fs.watch(root, { recursive: true, signal: controller.signal });
    let err: Error | undefined = undefined;
    const fn = mock();
    watcher.on("error", fn);
    watcher.on("close", fn);
    controller.abort(new Error("potato"));

    await Bun.sleep(10);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0].message).toBe("potato");
  });

  test("add file/folder to subfolder", done => {
    let count = 0;
    const root = path.join(testDir, "add-subdirectory");
    try {
      fs.mkdirSync(root);
    } catch {}
    const subfolder = path.join(root, "subfolder");
    fs.mkdirSync(subfolder);
    const watcher = fs.watch(root, { recursive: true, signal: AbortSignal.timeout(3000) });
    let err: Error | undefined = undefined;
    watcher.on("change", (event, filename) => {
      const basename = path.basename(filename as string);

      if (basename === "subfolder") return;
      count++;
      try {
        expect(["rename", "change"]).toContain(event);
        expect(["new-file.txt", "new-folder.txt"]).toContain(basename);
        if (count >= 2) {
          watcher.close();
        }
      } catch (e: any) {
        err = e;
        watcher.close();
      }
    });
    watcher.on("error", e => (err = e));
    watcher.on("close", () => {
      clearInterval(interval);
      done(err);
    });

    const interval = repeat(() => {
      fs.writeFileSync(path.join(subfolder, "new-file.txt"), "hello");
      fs.mkdirSync(path.join(subfolder, "new-folder.txt"));
      fs.rmdirSync(path.join(subfolder, "new-folder.txt"));
    });
  });

  test("should emit event when file is deleted", done => {
    const testsubdir = tempDirWithFiles("subdir", {
      "deleted.txt": "hello",
    });
    const filepath = path.join(testsubdir, "deleted.txt");
    let err: Error | undefined = undefined;
    const watcher = fs.watch(testsubdir, function (event, filename) {
      try {
        expect(["rename", "change"]).toContain(event);
        expect(filename).toBe("deleted.txt");
      } catch (e: any) {
        err = e;
      } finally {
        clearInterval(interval);
        watcher.close();
      }
    });

    watcher.once("close", () => {
      done(err);
    });

    const interval = repeat(() => {
      fs.rmSync(filepath, { force: true });
      const fd = fs.openSync(filepath, "w");
      fs.closeSync(fd);
    });
  });

  // https://github.com/oven-sh/bun/issues/5442
  test("should work with paths with trailing slashes", done => {
    const testsubdir = tempDirWithFiles("subdir", {
      "trailing.txt": "hello",
    });
    const filepath = path.join(testsubdir, "trailing.txt");
    let err: Error | undefined = undefined;
    const watcher = fs.watch(testsubdir + "/", function (event, filename) {
      try {
        expect(event).toBe("rename");
        expect(filename).toBe("trailing.txt");
      } catch (e: any) {
        err = e;
      } finally {
        clearInterval(interval);
        watcher.close();
      }
    });

    watcher.once("close", () => {
      done(err);
    });

    const interval = repeat(() => {
      fs.rmSync(filepath, { force: true });
      const fd = fs.openSync(filepath, "w");
      fs.closeSync(fd);
    });
  });

  test("should emit 'change' event when file is modified", done => {
    const filepath = path.join(testDir, "watch.txt");

    const watcher = fs.watch(filepath);
    let err: Error | undefined = undefined;
    watcher.on("change", function (event, filename) {
      try {
        expect(event).toBe("change");
        expect(filename).toBe("watch.txt");
      } catch (e: any) {
        err = e;
      } finally {
        clearInterval(interval);
        watcher.close();
      }
    });

    watcher.once("close", () => {
      done(err);
    });

    const interval = repeat(() => {
      fs.writeFileSync(filepath, "world");
    });
  }, 10000);

  test("should error on invalid path", done => {
    try {
      fs.watch(path.join(testDir, "404.txt"));
      done(new Error("should not reach here"));
    } catch (err: any) {
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ENOENT");
      expect(err.syscall).toBe("watch");
      done();
    }
  });

  const encodings = ["utf8", "buffer", "hex", "ascii", "base64", "utf16le", "ucs2", "latin1", "binary"] as const;

  test(`should work with encodings ${encodings.join(", ")}`, async () => {
    const watchers: FSWatcher[] = [];
    const filepath = path.join(testDir, encodingFileName);

    const promises: Promise<any>[] = [];
    encodings.forEach(encoding => {
      const encoded_filename =
        encoding !== "buffer"
          ? Buffer.from(encodingFileName, "utf8").toString(encoding)
          : Buffer.from(encodingFileName);

      promises.push(
        new Promise((resolve, reject) => {
          watchers.push(
            fs.watch(filepath, { encoding: encoding }, (event, filename) => {
              try {
                expect(event).toBe("change");

                if (encoding !== "buffer") {
                  expect(filename).toBe(encoded_filename);
                } else {
                  expect(filename).toBeInstanceOf(Buffer);
                  expect((filename as any as Buffer)!.toString("utf8")).toBe(encodingFileName);
                }

                resolve(undefined);
              } catch (e: any) {
                reject(e);
              }
            }),
          );
        }),
      );
    });

    const interval = repeat(() => {
      fs.writeFileSync(filepath, "world");
    });

    try {
      await Promise.all(promises);
    } finally {
      clearInterval(interval);
      watchers.forEach(watcher => watcher.close());
    }
  }, 10000);

  test("should work with url", done => {
    const filepath = path.join(testDir, "url.txt");
    try {
      const watcher = fs.watch(pathToFileURL(filepath));
      let err: Error | undefined = undefined;
      watcher.on("change", function (event, filename) {
        try {
          expect(event).toBe("change");
          expect(filename).toBe("url.txt");
        } catch (e: any) {
          err = e;
        } finally {
          clearInterval(interval);
          watcher.close();
        }
      });

      watcher.once("close", () => {
        done(err);
      });

      const interval = repeat(() => {
        fs.writeFileSync(filepath, "world");
      });
    } catch (e: any) {
      done(e);
    }
  });

  test("calling close from error event should not throw", done => {
    const filepath = path.join(testDir, "close.txt");
    try {
      const ac = new AbortController();
      const watcher = fs.watch(pathToFileURL(filepath), { signal: ac.signal });
      watcher.once("error", err => {
        try {
          watcher.close();
          done();
        } catch (e: any) {
          done("Should not error when calling close from error event");
        }
      });
      ac.abort();
    } catch (e: any) {
      done(e);
    }
  });

  test("calling close from close event should not throw", done => {
    const filepath = path.join(testDir, "close-close.txt");
    try {
      const ac = new AbortController();
      const watcher = fs.watch(pathToFileURL(filepath), { signal: ac.signal });

      watcher.once("close", () => {
        try {
          watcher.close();
          done();
        } catch (e: any) {
          done("Should not error when calling close from close event");
        }
      });

      ac.abort();
    } catch (e: any) {
      done(e);
    }
  });

  test("Signal aborted after creating the watcher", async () => {
    const filepath = path.join(testDir, "abort.txt");

    const ac = new AbortController();
    const promise = new Promise((resolve, reject) => {
      const watcher = fs.watch(filepath, { signal: ac.signal });
      watcher.once("error", err => (err.message === "The operation was aborted." ? resolve(undefined) : reject(err)));
      watcher.once("close", () => reject());
    });
    await Bun.sleep(10);
    ac.abort();
    await promise;
  });

  test("Signal aborted before creating the watcher", async () => {
    const filepath = path.join(testDir, "abort.txt");

    const signal = AbortSignal.abort();
    await new Promise((resolve, reject) => {
      const watcher = fs.watch(filepath, { signal });
      watcher.once("error", err => (err.message === "The operation was aborted." ? resolve(undefined) : reject(err)));
      watcher.once("close", () => reject());
    });
  });

  test("should work with symlink", async () => {
    const filepath = path.join(testDir, "sym-symlink2.txt");
    await fs.promises.symlink(path.join(testDir, "sym-sync.txt"), filepath);

    const interval = repeat(() => {
      fs.writeFileSync(filepath, "hello");
    });

    const promise = new Promise((resolve, reject) => {
      let timeout: any = null;
      const watcher = fs.watch(filepath, event => {
        clearTimeout(timeout);
        clearInterval(interval);
        try {
          resolve(event);
        } catch (e: any) {
          reject(e);
        } finally {
          watcher.close();
        }
      });
      setTimeout(() => {
        clearInterval(interval);
        watcher?.close();
        reject("timeout");
      }, 3000);
    });
    expect(promise).resolves.toBe("change");
  });

  // on windows 0o200 will be readable (match nodejs behavior)
  test.skipIf(isWindows)("should throw if no permission to watch the directory", async () => {
    const filepath = path.join(testDir, "permission-dir");
    fs.mkdirSync(filepath, { recursive: true });
    fs.chmodSync(filepath, 0o200);
    try {
      const watcher = fs.watch(filepath);
      watcher.close();
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toBe(`EACCES: permission denied, watch '${filepath}'`);
      expect(err.path).toBe(filepath);
      expect(err.code).toBe("EACCES");
      expect(err.syscall).toBe("watch");
    }
  });

  test.skipIf(isWindows)("should throw if no permission to watch the file", async () => {
    const filepath = path.join(testDir, "permission-file.txt");

    fs.writeFileSync(filepath, "hello.txt");
    fs.chmodSync(filepath, 0o200);
    try {
      const watcher = fs.watch(filepath);
      watcher.close();
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toBe(`EACCES: permission denied, watch '${filepath}'`);
      expect(err.path).toBe(filepath);
      expect(err.code).toBe("EACCES");
      expect(err.syscall).toBe("watch");
    }
  });
});

describe("fs.promises.watch", () => {
  test("add file/folder to folder", async () => {
    let count = 0;
    const root = path.join(testDir, "add-promise-directory");
    try {
      fs.mkdirSync(root);
    } catch {}
    let success = false;
    let err: Error | undefined = undefined;
    try {
      const ac = new AbortController();
      const watcher = fs.promises.watch(root, { signal: ac.signal });

      const interval = repeat(() => {
        fs.writeFileSync(path.join(root, "new-file.txt"), "hello");
        fs.mkdirSync(path.join(root, "new-folder.txt"));
        fs.rmdirSync(path.join(root, "new-folder.txt"));
      });

      for await (const event of watcher) {
        count++;
        try {
          expect(["rename", "change"]).toContain(event.eventType);
          expect(["new-file.txt", "new-folder.txt"]).toContain(event.filename);

          if (count >= 2) {
            success = true;
            clearInterval(interval);
            ac.abort();
          }
        } catch (e: any) {
          err = e;
          clearInterval(interval);
          ac.abort();
        }
      }
    } catch (e: any) {
      if (!success) {
        throw err || e;
      }
    }
  });

  test("add file/folder to subfolder", async () => {
    let count = 0;
    const root = path.join(testDir, "add-promise-subdirectory");
    try {
      fs.mkdirSync(root);
    } catch {}
    const subfolder = path.join(root, "subfolder");
    fs.mkdirSync(subfolder);
    let success = false;
    let err: Error | undefined = undefined;

    try {
      const ac = new AbortController();
      const watcher = fs.promises.watch(root, { recursive: true, signal: ac.signal });

      const interval = repeat(() => {
        fs.writeFileSync(path.join(subfolder, "new-file.txt"), "hello");
        fs.mkdirSync(path.join(subfolder, "new-folder.txt"));
        fs.rmdirSync(path.join(subfolder, "new-folder.txt"));
      });
      for await (const event of watcher) {
        const basename = path.basename(event.filename!);
        if (basename === "subfolder") continue;

        count++;
        try {
          expect(["rename", "change"]).toContain(event.eventType);
          expect(["new-file.txt", "new-folder.txt"]).toContain(basename);

          if (count >= 2) {
            success = true;
            clearInterval(interval);
            ac.abort();
          }
        } catch (e: any) {
          err = e;
          clearInterval(interval);
          ac.abort();
        }
      }
    } catch (e: any) {
      if (!success) {
        throw err || e;
      }
    }
  });

  test("Signal aborted after creating the watcher", async () => {
    const filepath = path.join(testDir, "abort.txt");

    const ac = new AbortController();
    const watcher = fs.promises.watch(filepath, { signal: ac.signal });

    const promise = (async () => {
      try {
        for await (const _ of watcher);
      } catch (e: any) {
        expect(e.message).toBe("The operation was aborted.");
      }
    })();
    await Bun.sleep(10);
    ac.abort();
    await promise;
  });

  test("Signal aborted before creating the watcher", async () => {
    const filepath = path.join(testDir, "abort.txt");

    const signal = AbortSignal.abort();
    const watcher = fs.promises.watch(filepath, { signal });
    await (async () => {
      try {
        for await (const _ of watcher);
      } catch (e: any) {
        expect(e.message).toBe("The operation was aborted.");
      }
    })();
  });

  test("should work with symlink -> symlink -> dir", async () => {
    const filepath = path.join(testDir, "sym-symlink-indirect");
    const dest = path.join(testDir, "sym-symlink-dest");

    fs.rmSync(filepath, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await fs.promises.symlink(dest, filepath);
    const indirect_sym = path.join(testDir, "sym-symlink-to-symlink-dir");
    await fs.promises.symlink(filepath, indirect_sym);

    const watcher = fs.promises.watch(indirect_sym);
    const interval = setInterval(() => {
      fs.writeFileSync(path.join(indirect_sym, "hello.txt"), "hello");
    }, 10);

    const promise = (async () => {
      try {
        for await (const event of watcher) {
          return event.eventType;
        }
      } catch {
        expect.unreachable();
      } finally {
        clearInterval(interval);
      }
    })();
    expect(promise).resolves.toBe("rename");
  });

  test("should work with symlink dir", async () => {
    const filepath = path.join(testDir, "sym-symlink-dir");
    const dest = path.join(testDir, "sym-symlink-dest");

    fs.rmSync(filepath, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await fs.promises.symlink(dest, filepath);

    const watcher = fs.promises.watch(filepath);
    const interval = setInterval(() => {
      fs.writeFileSync(path.join(filepath, "hello.txt"), "hello");
    }, 10);

    const promise = (async () => {
      try {
        for await (const event of watcher) {
          return event.eventType;
        }
      } catch {
        expect.unreachable();
      } finally {
        clearInterval(interval);
      }
    })();
    expect(promise).resolves.toBe("rename");
  });

  test("should work with symlink", async () => {
    const filepath = path.join(testDir, "sym-symlink.txt");
    await fs.promises.symlink(path.join(testDir, "sym.txt"), filepath);

    const watcher = fs.promises.watch(filepath);
    const interval = repeat(() => {
      fs.writeFileSync(filepath, "hello");
    });

    const promise = (async () => {
      try {
        for await (const event of watcher) {
          return event.eventType;
        }
      } catch (e: any) {
        expect.unreachable();
      } finally {
        clearInterval(interval);
      }
    })();
    expect(promise).resolves.toBe("change");
  });
});

describe("immediately closing", () => {
  test("works correctly with files", async () => {
    const filepath = path.join(testDir, "close.txt");
    for (let i = 0; i < 100; i++) fs.watch(filepath, { persistent: true }).close();
    for (let i = 0; i < 100; i++) fs.watch(filepath, { persistent: false }).close();
  });
  test("works correctly with directories", async () => {
    for (let i = 0; i < 100; i++) fs.watch(testDir, { persistent: true }).close();
    for (let i = 0; i < 100; i++) fs.watch(testDir, { persistent: false }).close();
  });
  test("works correctly with recursive directories", async () => {
    for (let i = 0; i < 100; i++) fs.watch(testDir, { persistent: true, recursive: true }).close();
    for (let i = 0; i < 100; i++) fs.watch(testDir, { persistent: false, recursive: false }).close();
  });
});
