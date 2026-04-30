import { pathToFileURL } from "bun";
import {
  bunEnv,
  bunExe,
  bunRun,
  bunRunAsScript,
  isLinux,
  isMacOS,
  isWindows,
  tempDir,
  tempDirWithFiles,
} from "harness";
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
  "sub dir with spaces": {
    "file.txt": "hello",
  },
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

  test("should work with file: URL string containing percent-encoded spaces", done => {
    const filepath = path.join(testDir, "sub dir with spaces", "file.txt");
    const fileUrl = pathToFileURL(filepath).href; // e.g. file:///tmp/.../sub%20dir%20with%20spaces/file.txt
    expect(fileUrl).toContain("%20");
    try {
      const watcher = fs.watch(fileUrl);
      let err: Error | undefined = undefined;
      watcher.on("change", function (event, filename) {
        try {
          expect(event).toBe("change");
          expect(filename).toBe("file.txt");
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

// FSWatcher.close() set `closed = true` before calling refTask(), so refTask() returned
// false without incrementing pending_activity_count and the paired unrefTask() ran anyway.
// For { persistent: false } watchers (count starts at 1), close() did a net -2, wrapping the
// u32 to MAX. hasPendingActivity() then returned true forever, pinning the native FSWatcher
// (and via its cached listener closure, the JS FSWatcher) as a GC root — a permanent leak
// per watcher. Persistent watchers only landed at 0 by accident (start=2, -2).
describe("closed FSWatcher is collectable", () => {
  for (const persistent of [false, true]) {
    test(`persistent: ${persistent}`, async () => {
      using dir = tempDir("fswatch-gc", { "f.txt": "x" });
      const watchDir = String(dir);

      const fixture = /* js */ `
        const fs = require("fs");

        let collected = 0;
        const registry = new FinalizationRegistry(() => { collected++; });

        const ITERS = 64;
        (function create() {
          for (let i = 0; i < ITERS; i++) {
            const w = fs.watch(${JSON.stringify(watchDir)}, { persistent: ${persistent} }, () => {});
            registry.register(w);
            w.close();
          }
        })();

        (async () => {
          for (let i = 0; i < 30 && collected < ITERS; i++) {
            Bun.gc(true);
            await Bun.sleep(10);
          }
          console.log(JSON.stringify({ collected, iters: ITERS }));
        })();
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const { collected, iters } = JSON.parse(stdout.trim());
      // Before the fix, `collected` is 0 for persistent:false — every watcher leaks.
      // After the fix, all of them are collectable; allow a little slack for GC timing.
      expect(collected).toBeGreaterThanOrEqual(Math.floor(iters / 2));
      expect(exitCode).toBe(0);
    });
  }
});

// On Windows, if fs.watch() fails after getOrPut() inserts into the internal path->watcher
// map (e.g. uv_fs_event_start fails on a dangling junction, an ACL-protected dir, or a
// directory deleted mid-watch), an errdefer that was silently broken by a !*T -> Maybe(*T)
// refactor left the entry in place with a dangling key and an uninitialized value. The next
// fs.watch() on the same path collided with the poisoned entry, returned the garbage value
// as a *PathWatcher, and segfaulted at 0xFFFFFFFFFFFFFFFF calling .handlers.put() on it.
//
// https://github.com/oven-sh/bun/issues/26254
// https://github.com/oven-sh/bun/issues/20203
// https://github.com/oven-sh/bun/issues/19635
//
// Must run in a subprocess: on an unpatched build this segfaults the whole runtime.
test.skipIf(!isWindows)("retrying a failed fs.watch does not crash (windows)", async () => {
  using dir = tempDir("fswatch-retry-failed", { "index.js": "" });
  const base = String(dir);

  const fixture = /* js */ `
    const { mkdirSync, rmdirSync, symlinkSync, watch } = require("node:fs");
    const { join } = require("node:path");

    const base   = ${JSON.stringify(base)};
    const target = join(base, "target");
    const link   = join(base, "link");

    mkdirSync(target);
    symlinkSync(target, link, "junction"); // junctions need no admin rights on Windows
    rmdirSync(target);                     // junction now dangles

    // Call 1: readlink(link) SUCCEEDS (returns the vanished target path into
    // a stack-local buffer), then uv_fs_event_start(target) fails ENOENT.
    // On unpatched builds: map entry left with dangling key + uninit value.
    try { watch(link); throw new Error("expected first watch to fail"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }

    // Call 2: identical stack frame layout -> identical outbuf address ->
    // identical key slice -> getOrPut returns found_existing=true ->
    // returns uninitialized value as a *PathWatcher -> segfault on unpatched builds.
    // Correct behaviour: throw ENOENT again.
    try { watch(link); throw new Error("expected second watch to fail"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }

    // Call 3: a valid watch must still work (map must not be corrupted).
    watch(base).close();

    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    cwd: base,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0); // unpatched: exitCode is 3 (Windows segfault)
});

// The FSEvents path in PathWatcher.init() dupeZ's the resolved directory path
// into `resolved_path`, but then immediately overwrote `this.*` with a struct
// literal that did not include `.resolved_path`, resetting it to its default
// `null`. PathWatcher.deinit()'s `if (this.resolved_path) |p| free(p)` was
// therefore a no-op, and FSEventsWatcher.deinit() does not own the buffer
// either. Every fs.watch(<directory>) on macOS leaked ~path-length bytes.
test.skipIf(!isMacOS)("fs.watch(dir) on macOS does not leak the resolved FSEvents path", async () => {
  // Use long nested directory names so the resolved absolute path (and thus
  // the per-watch leak) is large enough to show up in RSS within a reasonable
  // number of iterations.
  const seg = Buffer.alloc(200, "p").toString();
  using dir = tempDir("fs-watch-fsevents-leak", {
    [`${seg}/${seg}/${seg}/.keep`]: "x",
  });
  const watchDir = path.join(String(dir), seg, seg, seg);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      /* ts */ `
        const fs = require("fs");
        const dir = process.argv[1];

        // Warm up: let the FSEvents loop thread, mimalloc pools, and the
        // PathWatcherManager fd cache reach steady state.
        for (let i = 0; i < 1000; i++) fs.watch(dir, () => {}).close();
        Bun.gc(true);
        const before = process.memoryUsage.rss();

        // With a ~700-byte resolved path, 5000 leaked dupeZ buffers is
        // ~3.5 MB of growth on unpatched builds. Keep the iteration count
        // low enough that rapid FSEventStream recreate doesn't exhaust the
        // kernel queue (FSEventStreamCreate -> NULL).
        for (let i = 0; i < 5000; i++) fs.watch(dir, () => {}).close();
        Bun.gc(true);
        const after = process.memoryUsage.rss();

        const growthMB = (after - before) / 1024 / 1024;
        console.log("RSS growth: " + growthMB.toFixed(2) + " MB");
        if (growthMB > 3) {
          throw new Error("fs.watch(dir) leaked " + growthMB.toFixed(2) + " MB");
        }
      `,
      watchDir,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr first so a leak regression surfaces the thrown growth message.
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("RSS growth:");
});

// The Linux backend joins the watched directory's absolute path with child
// names into a bun.PathBuffer (4096 bytes) via joinZBuf/joinStringBuf with no
// bounds check. A watched directory whose absolute path is near PATH_MAX plus
// a NAME_MAX (255) entry overflows the buffer — a safety panic in debug/ASAN,
// silent corruption in release. Linux-only: macOS uses FSEvents and Windows
// uses win_watcher.zig. Exercises four code paths:
//   - non-recursive watch + create long-named file (inotify dispatch)
//   - recursive watch + pre-existing long-named subdir (walkSubtree at
//     registration time)
//   - recursive watch + create long-named subdir (new-directory handling in
//     the inotify reader thread, which rebuilds the absolute path to register
//     a watch on it)
//   - recursive watch + create long-named file
test.skipIf(!isLinux)(
  "fs.watch on a near-PATH_MAX directory does not overflow when a long-named entry is created inside",
  async () => {
    using dir = tempDir("fs-watch-pathmax-overflow", {});

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* ts */ `
          const fs = require("fs");
          const path = require("path");
          const base = process.argv[1];

          // Build a directory tree whose absolute path exceeds 3840 bytes so
          // abs + sep + 255-byte name is guaranteed > 4096 regardless of the
          // TMPDIR base length. Create each segment via a relative mkdir so
          // the per-call path stays well under PATH_MAX.
          const seg = Buffer.alloc(200, "d").toString();
          process.chdir(base);
          let abs = base;
          let rel = ".";
          while (abs.length + 1 + seg.length < 4050) {
            rel = path.join(rel, seg);
            abs = path.join(abs, seg);
            fs.mkdirSync(rel);
          }
          // abs.length is now in [3849, 4049]; abs + "/" + 255-byte name > 4096.
          process.chdir(rel);

          // Pre-existing NAME_MAX-length subdirectory so the recursive watch's
          // initial walkSubtree sees an entry whose absolute path won't fit.
          const longSub = Buffer.alloc(255, "s").toString();
          fs.mkdirSync(longSub);

          const wN = fs.watch(abs, () => {});
          const wR = fs.watch(abs, { recursive: true }, () => {});
          for (const w of [wN, wR]) w.on("error", () => {});

          // Create a NAME_MAX-length file and a second NAME_MAX-length
          // subdirectory inside the watched directory. Relative paths (cwd =
          // deep dir) keep each syscall under PATH_MAX. The subdirectory
          // IN_CREATE|IN_ISDIR event makes the recursive watcher rebuild the
          // absolute child path to register a new inotify watch on it.
          const longFile = Buffer.alloc(255, "f").toString();
          const longSub2 = Buffer.alloc(254, "S").toString() + "2";
          let i = 0;
          const timer = setInterval(() => {
            fs.writeFileSync(longFile, "x");
            try { fs.mkdirSync(longSub2); } catch {}
            if (++i > 10) {
              clearInterval(timer);
              wN.close();
              wR.close();
              console.log("OK " + abs.length);
            }
          }, 20);
        `,
        String(dir),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toStartWith("OK ");
    expect(exitCode).toBe(0);
  },
);
