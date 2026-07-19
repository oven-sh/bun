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
import { EventEmitter } from "node:events";
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

  test("returns an FSWatcher that inherits from EventEmitter", () => {
    const watcher = fs.watch(path.join(testDir, "watch.txt"));
    try {
      expect(watcher).toBeInstanceOf(EventEmitter);
      expect(watcher.constructor.name).toBe("FSWatcher");
      expect(typeof watcher.ref).toBe("function");
      expect(typeof watcher.unref).toBe("function");
      expect(typeof watcher.start).toBe("function");
    } finally {
      watcher.close();
    }
  });

  test("errors from watching a missing path keep path and filename properties", () => {
    const missing = path.join(testDir, "missing-subdir", "404.txt");
    try {
      fs.watch(missing);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
      expect(err.path).toBe(missing);
      expect(err.filename).toBe(missing);
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
  // Root has CAP_DAC_OVERRIDE, so the chmod 0o200 below never yields the
  // EACCES these two tests expect; they only make sense as a non-root user.
  const isRoot = process.getuid?.() === 0;

  test.skipIf(isWindows || isRoot)("should throw if no permission to watch the directory", async () => {
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

  test.skipIf(isWindows || isRoot)("should throw if no permission to watch the file", async () => {
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

  // Self-events (the watched path itself is deleted or renamed) carry no name,
  // and node (libuv) reports basename(watched path) for them. Deleting the
  // watched path also retires its inotify watch: the kernel queues
  // IN_DELETE_SELF followed by IN_IGNORED and node reports both as "rename".
  // The exact sequences are inotify-specific, so Linux only.
  // https://github.com/oven-sh/bun/issues/23306
  async function collectWatchEvents(target: string, renames: number, act: () => void) {
    const events: [string, string | null][] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const watcher = fs.watch(target, (eventType, filename) => {
      events.push([eventType, filename]);
      if (events.filter(([type]) => type === "rename").length === renames) resolve();
    });
    watcher.once("error", reject);
    try {
      act();
      await promise;
    } finally {
      watcher.close();
    }
    return events;
  }

  test.skipIf(!isLinux)("unlinking the watched file delivers both rename self-events", async () => {
    using dir = tempDir("fs-watch-unlink-self", { "f.txt": "x" });
    const target = path.join(String(dir), "f.txt");
    // unlink(2) emits IN_ATTRIB (link count drop), IN_DELETE_SELF, IN_IGNORED.
    expect(await collectWatchEvents(target, 2, () => fs.unlinkSync(target))).toEqual([
      ["change", "f.txt"],
      ["rename", "f.txt"],
      ["rename", "f.txt"],
    ]);
  });

  test.skipIf(!isLinux)("removing the watched directory delivers both rename self-events named after it", async () => {
    using dir = tempDir("fs-watch-rmdir-self", { "sub": {} });
    const target = path.join(String(dir), "sub");
    expect(await collectWatchEvents(target, 2, () => fs.rmdirSync(target))).toEqual([
      ["rename", "sub"],
      ["rename", "sub"],
    ]);
  });

  test.skipIf(!isLinux)("renaming the watched directory away reports its basename", async () => {
    using dir = tempDir("fs-watch-mv-self", { "sub": {} });
    const target = path.join(String(dir), "sub");
    expect(await collectWatchEvents(target, 1, () => fs.renameSync(target, path.join(String(dir), "moved")))).toEqual([
      ["rename", "sub"],
    ]);
  });

  // Past fs.inotify.max_queued_events the kernel drops events and queues one
  // IN_Q_OVERFLOW; Bun reports it as ('change', null) on every watcher sharing
  // the inotify fd, the same shape node uses for overflow on Windows.
  const inotifySysctl = (name: string) => {
    try {
      return Number(fs.readFileSync(`/proc/sys/fs/inotify/${name}`, "utf8").trim());
    } catch {
      return 0;
    }
  };
  const maxQueuedEvents = isLinux ? inotifySysctl("max_queued_events") : 0;
  // Enough directories that unregistering one watch per directory overflows
  // the queue even if the reader thread drains a full 64KB read (4096 events).
  const overflowDirCount = maxQueuedEvents + 6144;
  // 16384 is the kernel default; a host tuned above that would need an
  // impractically large directory tree, so skip there.
  const canOverflowInotify =
    isLinux &&
    maxQueuedEvents > 0 &&
    maxQueuedEvents <= 16384 &&
    inotifySysctl("max_user_watches") >= overflowDirCount + 1024;

  // The directory count is fixed by the kernel (the overflow needs more watch
  // removals than max_queued_events=16384 plus one 64KB read the reader may
  // drain), so setup is ~22k syscalls: well past the 5s default under ASAN.
  test.skipIf(!canOverflowInotify)(
    "inotify queue overflow is delivered as ('change', null)",
    async () => {
      using dir = tempDir("fs-watch-overflow", { "observed": {} });
      const root = String(dir);
      const observedDir = path.join(root, "observed");
      const treeDir = path.join(root, "tree");
      fs.mkdirSync(treeDir);
      for (let i = 0; i < overflowDirCount; i++) fs.mkdirSync(path.join(treeDir, "d" + i));

      const overflow = Promise.withResolvers<[string, string | null]>();
      const bufferOverflow = Promise.withResolvers<[string, Buffer | null]>();
      const survived = Promise.withResolvers<[string, string | null]>();
      // An error or unexpected close on either watcher must reject every pending
      // promise so the test reports the failure instead of hanging to the
      // timeout. The no-op catch keeps the not-yet-awaited ones handled.
      const pending = [overflow, bufferOverflow, survived];
      for (const p of pending) p.promise.catch(() => {});
      const fail = (err: unknown) => pending.forEach(p => p.reject(err));
      const watcher = fs.watch(observedDir, (eventType, filename) => {
        if (filename === null) overflow.resolve([eventType, filename]);
        else if (filename === "f.txt") survived.resolve([eventType, filename]);
      });
      // The overflow event carries no name to encode, so every encoding gets null.
      const bufferWatcher = fs.watch(observedDir, { encoding: "buffer" }, (eventType, filename) => {
        if (filename === null) bufferOverflow.resolve([eventType, filename]);
      });
      let closing = false;
      for (const w of [watcher, bufferWatcher]) {
        w.once("error", fail);
        w.once("close", () => {
          if (!closing) fail(new Error("watcher closed unexpectedly"));
        });
      }
      try {
        // Closing the recursive watcher unregisters one inotify watch per
        // directory in a single critical section; each unregister queues an
        // IN_IGNORED the blocked reader can't drain, overflowing the queue.
        fs.watch(treeDir, { recursive: true }, () => {}).close();
        expect(await overflow.promise).toEqual(["change", null]);
        expect(await bufferOverflow.promise).toEqual(["change", null]);
        // Overflow signals lost events; the watcher itself must keep working.
        fs.writeFileSync(path.join(observedDir, "f.txt"), "x");
        expect(await survived.promise).toEqual(["rename", "f.txt"]);
      } finally {
        closing = true;
        watcher.close();
        bufferWatcher.close();
      }
    },
    90_000,
  );
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

  test("Signal aborted before creating the watcher does not keep the process alive", async () => {
    const filepath = path.join(testDir, "abort.txt");
    // If a native watcher were created for a pre-aborted signal, nothing
    // would ever close it and the process would never exit.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
        const signal = AbortSignal.abort();
        (async () => {
          try {
            for await (const _ of fs.promises.watch(${JSON.stringify(filepath)}, { signal }));
            throw new Error("expected AbortError");
          } catch (e) {
            if (e.name !== "AbortError") throw e;
          }
        })();`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

  test("async iterator has return() and throw() that return Promises", async () => {
    const root = path.join(testDir, "iter-shape-dir");
    fs.mkdirSync(root, { recursive: true });
    const it = fs.promises.watch(root)[Symbol.asyncIterator]();
    expect(typeof it.return).toBe("function");
    expect(typeof it.throw).toBe("function");
    const ret = it.return();
    expect(ret).toBeInstanceOf(Promise);
    expect(await ret).toEqual({ value: undefined, done: true });
    expect(await it.next()).toEqual({ value: undefined, done: true });

    const it2 = fs.promises.watch(root)[Symbol.asyncIterator]();
    const err = new Error("boom");
    const thrown = it2.throw(err);
    expect(thrown).toBeInstanceOf(Promise);
    await expect(thrown).rejects.toBe(err);
    expect(await it2.next()).toEqual({ value: undefined, done: true });
  });

  test("concurrent next() calls both resolve", async () => {
    const root = path.join(testDir, "concurrent-next-dir");
    fs.mkdirSync(root, { recursive: true });
    const ac = new AbortController();
    const it = fs.promises.watch(root, { signal: ac.signal })[Symbol.asyncIterator]();
    try {
      // Two pending next() calls issued before any event fires. The previous
      // hand-rolled iterator had a single resolver slot, so p2 overwrote p1's
      // resolver and p1 would never settle (hangs until the test timeout).
      const p1 = it.next();
      const p2 = it.next();
      const interval = repeat(() => {
        fs.writeFileSync(path.join(root, "a.txt"), "1");
        fs.writeFileSync(path.join(root, "b.txt"), "2");
      });
      const [r1, r2] = await Promise.all([p1, p2]).finally(() => clearInterval(interval));
      expect(r1.done).toBe(false);
      expect(["rename", "change"]).toContain(r1.value.eventType);
      expect(r2.done).toBe(false);
      expect(["rename", "change"]).toContain(r2.value.eventType);
    } finally {
      ac.abort();
      await it.return().catch(() => {});
    }
  });

  test("never-iterated watch() does not keep the process alive", async () => {
    const root = path.join(testDir, "never-iterated-dir");
    fs.mkdirSync(root, { recursive: true });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const it = require("node:fs").promises.watch(${JSON.stringify(root)});` +
          `console.log(typeof it[Symbol.asyncIterator]);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  });

  test("yields events with a null prototype", async () => {
    const root = path.join(testDir, "null-proto-dir");
    fs.mkdirSync(root, { recursive: true });
    const ac = new AbortController();
    const watcher = fs.promises.watch(root, { signal: ac.signal });

    const interval = repeat(() => {
      fs.writeFileSync(path.join(root, "null-proto.txt"), "hello");
    });

    let event;
    try {
      for await (const e of watcher) {
        event = e;
        break;
      }
    } finally {
      clearInterval(interval);
      ac.abort();
    }

    expect(event).toBeDefined();
    expect(Object.getPrototypeOf(event)).toBe(null);
    // @ts-expect-error
    expect(event.hasOwnProperty).toBeUndefined();
    expect(() => String(event)).toThrow(TypeError);
    expect(Object.keys(event!).sort()).toEqual(["eventType", "filename"]);
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

// libuv signals a ReadDirectoryChangesW buffer overflow (events were lost) by
// invoking the fs_event callback with a NULL filename; node surfaces it as a
// 'change' event with a null filename, for every encoding, so callers can rescan.
test.skipIf(!isWindows)(
  "fs.watch delivers a null-filename 'change' event when ReadDirectoryChangesW overflows (windows)",
  async () => {
    using dir = tempDir("fswatch-overflow-win", {});
    const watchDir = String(dir);
    // ~100-char names make ~210-byte FILE_NOTIFY_INFORMATION entries, so ~19
    // fill libuv's 4KB buffer; 100 blocked-loop writes overflow it ~5x over.
    const N = 100;

    const fixture = /* js */ `
      const fs = require("node:fs");
      const path = require("node:path");

      const dir = ${JSON.stringify(watchDir)};
      const N = ${N};

      const stats = {
        utf8: { names: new Set(), nulls: 0, nullEventTypes: new Set() },
        buffer: { names: new Set(), nulls: 0, nullEventTypes: new Set() },
      };
      const { promise, resolve, reject } = Promise.withResolvers();
      let settled = false;
      const settle = fn => { if (!settled) { settled = true; fn(); } };

      // Per watcher, the contract is: every created file is observed, or the
      // overflow notification (strictly-null filename) arrives.
      const done = s => s.nulls > 0 || s.names.size >= N;
      const seen = (slot, eventType, filename) => {
        if (filename === null) {
          slot.nulls++;
          slot.nullEventTypes.add(eventType);
        } else {
          slot.names.add(String(filename));
        }
        if (done(stats.utf8) && done(stats.buffer)) settle(resolve);
      };

      const watchers = [
        fs.watch(dir, { encoding: "utf8" }, (e, f) => seen(stats.utf8, e, f)),
        fs.watch(dir, { encoding: "buffer" }, (e, f) => seen(stats.buffer, e, f)),
      ];
      for (const w of watchers) {
        w.on("error", err => settle(() => reject(err)));
        w.on("close", () => settle(() => reject(new Error("watcher closed before overflow or full delivery"))));
      }

      // The watch is armed synchronously, so sync-writing N files now blocks
      // the event loop while libuv's 4KB ReadDirectoryChangesW buffer fills
      // and overflows, forcing the lost-events notification.
      const pad = Buffer.alloc(90, "x").toString();
      for (let i = 0; i < N; i++) {
        fs.writeFileSync(path.join(dir, "f" + pad + String(i).padStart(3, "0") + ".txt"), "");
      }

      // Bounded window: on a build that drops the overflow notification the
      // condition never becomes true, so give up and report what arrived.
      const giveUp = setTimeout(() => settle(resolve), 3_000);

      promise
        .finally(() => {
          clearTimeout(giveUp);
          for (const w of watchers) w.close();
          console.log(JSON.stringify({
            utf8: { names: stats.utf8.names.size, nulls: stats.utf8.nulls, nullEventTypes: [...stats.utf8.nullEventTypes] },
            buffer: { names: stats.buffer.names.size, nulls: stats.buffer.nulls, nullEventTypes: [...stats.buffer.nullEventTypes] },
          }));
        })
        .catch(err => {
          console.error(err);
          process.exitCode = 1;
        });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    type Slot = { names: number; nulls: number; nullEventTypes: string[] };
    let result: { utf8: Slot; buffer: Slot };
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`fixture produced no JSON\nstdout: ${stdout}\nstderr: ${stderr}`);
    }

    const summarize = (s: Slot) =>
      s.names >= N
        ? "all events delivered"
        : s.nulls > 0
          ? `overflow signaled via ${JSON.stringify(s.nullEventTypes)}`
          : `silent loss: ${JSON.stringify(s)}`;

    const okDelivery = expect.stringMatching(/^(all events delivered|overflow signaled via \["change"\])$/);
    expect({
      utf8: summarize(result.utf8),
      buffer: summarize(result.buffer),
      signalCode: proc.signalCode, // the fixture must exit on its own
      exitCode,
    }).toEqual({
      utf8: okDelivery,
      buffer: okDelivery,
      signalCode: null,
      exitCode: 0,
    });
  },
);

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

        async function cycle(count) {
          for (let i = 0; i < count; i++) fs.watch(dir, () => {}).close();
          // close() delivers the 'close' event via queueMicrotask; without a
          // drain, every iteration's pending microtask graph (~6 objects)
          // survives the GC below and reads as growth.
          await 1;
          Bun.gc(true);
        }

        // Warm up: let the FSEvents loop thread, mimalloc pools, JSC heap
        // sizing, and the PathWatcherManager caches reach steady state
        // (one-time growth tapers off only after ~10k cycles).
        for (let i = 0; i < 3; i++) await cycle(5000);
        const before = process.memoryUsage.rss();

        // With a ~700-byte resolved path, 5000 leaked dupeZ buffers is
        // ~3.5 MB of growth on unpatched builds. Keep the iteration count
        // low enough that rapid FSEventStream recreate doesn't exhaust the
        // kernel queue (FSEventStreamCreate -> NULL).
        await cycle(5000);
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

// On Windows, fs.watch() registered every watcher into a single process-global
// PathWatcherManager bound to the first caller's VM/uv_loop. A Worker thread
// calling fs.watch() reused that manager: it mutated the watcher map and drove
// the main thread's uv_loop from a foreign thread (debug builds tripped a
// debug_assert and aborted; release builds raced). The manager is now
// re-allocated per VM, so a Worker's watcher never aliases the main thread's.
//
// Must run in a subprocess: on an unpatched debug build the Worker's
// fs.watch() call aborts the whole runtime.
test.skipIf(!isWindows)(
  "fs.watch works from both the main thread and a Worker (windows)",
  async () => {
    using dir = tempDir("fswatch-worker", {
      "main-watched/.keep": "",
      "worker-watched/.keep": "",
      "worker.js": /* js */ `
        import fs from "node:fs";
        import path from "node:path";
        import { parentPort } from "node:worker_threads";

        const dir = path.join(import.meta.dir, "worker-watched");
        // Before the fix this call registered into the main thread's manager.
        const watcher = fs.watch(dir, () => {
          clearInterval(interval);
          watcher.close();
          parentPort.postMessage("worker-saw-change");
        });
        const interval = setInterval(() => {
          fs.writeFileSync(path.join(dir, "touch.txt"), String(Date.now()));
        }, 20);
      `,
      "main.js": /* js */ `
        import fs from "node:fs";
        import path from "node:path";
        import { Worker } from "node:worker_threads";

        const mainDir = path.join(import.meta.dir, "main-watched");

        function watchForOneChange(dir) {
          return new Promise((resolve, reject) => {
            const watcher = fs.watch(dir, () => {
              clearInterval(interval);
              watcher.close();
              resolve();
            });
            watcher.on("error", err => {
              clearInterval(interval);
              reject(err);
            });
            const interval = setInterval(() => {
              fs.writeFileSync(path.join(dir, "touch.txt"), String(Date.now()));
            }, 20);
          });
        }

        // 1. The main thread registers the first watcher, creating the watcher
        //    manager bound to the main VM.
        await watchForOneChange(mainDir);

        // 2. A Worker registers its own watcher and must observe a change.
        const worker = new Worker(path.join(import.meta.dir, "worker.js"));
        const msg = await new Promise((resolve, reject) => {
          worker.on("message", resolve);
          worker.on("error", reject);
        });
        if (msg !== "worker-saw-change") throw new Error("unexpected worker message: " + msg);
        await worker.terminate();

        // 3. The main thread's watching must keep working after the Worker
        //    registered (and tore down) its own watcher.
        await watchForOneChange(mainDir);

        console.log("OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0); // unpatched debug builds abort in the Worker's fs.watch()
  },
  30000,
);

// FSWatcher::init joins the user-supplied watch path with the process cwd into a
// fixed pooled path buffer. The raw-path length validator only bounds the path
// itself, so a relative path just under the platform path limit used to overflow
// the buffer during the join and abort the whole process (panic=abort) instead of
// surfacing an error to JavaScript. Must run in a subprocess: on an unfixed build
// the abort would take down the test runner itself.
test("fs.watch reports an error for relative paths that no longer fit in the path buffer once joined with the cwd", async () => {
  using dir = tempDir("fswatch-long-relative", {
    "watch-me.txt": "hello",
  });
  const base = String(dir);

  const fixture = /* js */ `
    const fs = require("node:fs");

    // Longest relative path that still passes the per-platform raw-path length
    // validation (MAX_PATH_BYTES); once joined with the cwd the normalized result
    // no longer fits in the destination path buffer.
    const maxPathBytes = { linux: 4096, darwin: 1024, win32: 32767 * 3 + 1 }[process.platform] ?? 1024;
    const segment = "a/";
    const longRelativePath = segment.repeat(Math.floor((maxPathBytes - 2) / segment.length));

    try {
      const watcher = fs.watch(longRelativePath, () => {});
      watcher.close();
      throw new Error("expected watching the overlong relative path to fail");
    } catch (err) {
      if (err.code !== "ENAMETOOLONG") throw err;
      if (err.syscall !== "watch") throw new Error("unexpected syscall: " + err.syscall);
    }

    // A normal relative path must still work after the rejected one.
    const ok = fs.watch("watch-me.txt", () => {});
    ok.close();

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
  // Unfixed builds overflow the pooled path buffer during the cwd join and abort
  // the subprocess instead of throwing a catchable error.
  expect(exitCode).toBe(0);
});

// The native FSWatcher holds a weak reference to its JS wrapper (rooted by
// hasPendingActivity while open). Exercise every emit path (change, error,
// abort, close) with forced GC between steps; a rooting/clearing mistake
// crashes the subprocess or drops the awaited events.
test("fs.watch wrapper reference survives GC across event, abort and close paths", async () => {
  using dir = tempDir("fswatch-jsref-gc", { "target.txt": "x" });
  const watchDir = String(dir);

  const fixture = /* js */ `
    const fs = require("fs");
    const path = require("path");
    const dir = ${JSON.stringify(watchDir)};
    const file = path.join(dir, "target.txt");

    // Write-and-poll until \`done()\` reports true; bounded so a missed event
    // becomes a crisp error instead of a hang with no diagnostics.
    async function pokeUntil(done, label) {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (done()) return;
        fs.writeFileSync(file, label + " " + attempt + " " + Math.random());
        Bun.gc(true);
        await Bun.sleep(10);
      }
      throw new Error("event never delivered: " + label);
    }

    async function main() {
      // Phase 1: event delivery + close event, with GC forced between steps.
      for (let round = 0; round < 3; round++) {
        let sawEvent;
        const gotEvent = new Promise(resolve => (sawEvent = resolve));
        const watcher = fs.watch(dir, () => sawEvent());
        Bun.gc(true);

        // Keep touching the file until the event lands (watch registration
        // can race the first write on some platforms).
        let delivered = false;
        gotEvent.then(() => (delivered = true));
        await pokeUntil(() => delivered, "round " + round);
        await gotEvent;

        const gotClose = new Promise(resolve => watcher.once("close", resolve));
        Bun.gc(true);
        watcher.close();
        Bun.gc(true);
        await gotClose;
      }

      // Phase 2: abort path under GC pressure.
      for (let i = 0; i < 3; i++) {
        const ac = new AbortController();
        const watcher = fs.watch(dir, { signal: ac.signal }, () => {});
        const gotAbort = new Promise((resolve, reject) => {
          watcher.once("error", err =>
            err.message === "The operation was aborted." ? resolve() : reject(err),
          );
        });
        Bun.gc(true);
        ac.abort();
        Bun.gc(true);
        await gotAbort;
      }

      // Phase 3: double-close and close-from-inside-listener under GC.
      {
        let closeFromListener;
        const closedFromListener = new Promise(resolve => (closeFromListener = resolve));
        const watcher = fs.watch(dir, () => {
          Bun.gc(true);
          watcher.close(); // re-entrant close from inside the native emit
          watcher.close(); // second close must be a no-op
          closeFromListener();
        });
        let done = false;
        closedFromListener.then(() => (done = true));
        await pokeUntil(() => done, "phase3");
        await closedFromListener;
        Bun.gc(true);
      }

      Bun.gc(true);
      console.log("OK");
    }

    main().catch(err => {
      console.error(err);
      process.exit(1);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);
