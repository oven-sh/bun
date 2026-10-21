import { pathToFileURL } from "bun";
import {
  bunEnv,
  bunExe,
  bunRun,
  bunRunAsScript,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isRoot,
  isWindows,
  nodeExe,
  tempDir,
  tempDirWithFiles,
} from "harness";
import { EventEmitter } from "node:events";
import fs, { FSWatcher } from "node:fs";
import vm from "node:vm";
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
  test.concurrent("non-persistent watcher should not block the event loop", async () => {
    // https://github.com/joyent/node/issues/2293 - non-persistent watcher should not block the event loop
    expect(await bunRun(path.join(import.meta.dir, "fixtures", "persistent.js"))).toSpawn();
  });

  test.concurrent("watcher should close and not block the event loop", async () => {
    expect(await bunRun(path.join(import.meta.dir, "fixtures", "close.js"))).toSpawn();
  });

  test.concurrent("unref watcher should not block the event loop", async () => {
    expect(await bunRun(path.join(import.meta.dir, "fixtures", "unref.js"))).toSpawn();
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
        expect(["new-file.txt", "new-folder.txt"]).toContain(filename as string);
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
      expect(typeof (watcher as any).start).toBe("function");
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

  test("an abort with no 'error' listener only closes; an 'error' listener that throws is an uncaught exception", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        process.on("uncaughtException", err => console.log("uncaught:", err.message));
        {
          const ac = new AbortController();
          const watcher = fs.watch(${JSON.stringify(import.meta.path)}, { signal: ac.signal });
          watcher.on("close", () => console.log("closed 1"));
          ac.abort();
        }
        {
          const ac = new AbortController();
          const watcher = fs.watch(${JSON.stringify(import.meta.path)}, { signal: ac.signal });
          watcher.on("error", err => { throw new Error("listener threw on " + err.name); });
          watcher.on("close", () => console.log("closed 2"));
          ac.abort();
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n").filter(Boolean).sort()).toEqual([
      "closed 1",
      "closed 2",
      "uncaught: listener threw on AbortError",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

  // When inotify_add_watch fails for a subdirectory during the recursive walk
  // (ENOSPC at the watch limit, EACCES on an unreadable subdir), bun used to
  // swallow the failure so the watcher looked healthy while whole subtrees
  // were silently unwatched. Now the first such failure is delivered as an
  // `'error'` event and the watcher keeps covering whatever did register,
  // matching node's recursive watcher.
  //
  // ENOSPC (the motivating case) needs the per-user inotify limit lowered,
  // which requires a private user namespace; CI containers disallow that via
  // seccomp. The same `add_one` error branch is reachable with EACCES by
  // watching a tree that contains one unreadable subdirectory as an
  // unprivileged user, so this test drops privileges to trigger it.
  test.skipIf(!isLinux || !isRoot)(
    "recursive watch surfaces inotify_add_watch failure on a subdirectory as an 'error' event",
    async () => {
      const NOBODY = 65534;
      using dir = tempDir("fs-watch-subtree-error", {
        "open/.keep": "",
        "locked/.keep": "",
      });
      const root = fs.realpathSync(String(dir));
      // The de-privileged child must be able to traverse into `root`, read it,
      // and write inside `open/`, while `locked/` denies read so
      // inotify_add_watch on it returns EACCES. CI's runner.node.ts points
      // TMPDIR at a mode-0700 mkdtemp dir, so every ancestor of `root` needs
      // +x for uid 65534 or the child fails at path resolution on the root
      // itself before the recursive walk ever reaches `locked/`.
      const ancestors: [string, number][] = [];
      for (let p = path.dirname(root); p !== path.dirname(p); p = path.dirname(p)) {
        const mode = fs.statSync(p).mode;
        if ((mode & 0o011) !== 0o011) {
          ancestors.push([p, mode & 0o7777]);
          fs.chmodSync(p, (mode & 0o7777) | 0o011);
        }
      }
      fs.chownSync(root, NOBODY, NOBODY);
      fs.chownSync(path.join(root, "open"), NOBODY, NOBODY);
      fs.chmodSync(root, 0o755);
      fs.chmodSync(path.join(root, "open"), 0o755);
      fs.chmodSync(path.join(root, "locked"), 0o000);

      const fixture = `
        const fs = require("fs"), path = require("path");
        const root = process.env.WATCH_ROOT;
        const seen = new Set();
        let errorEvent = null, closed = false;
        const w = fs.watch(root, { recursive: true }, (t, f) => seen.add(String(f)));
        w.on("error", e => {
          errorEvent = { code: e.code, syscall: e.syscall, path: e.path };
          // Prove the watcher survives the error: a change under the readable
          // subtree must still arrive.
          fs.writeFileSync(path.join(root, "open", "p.txt"), "x");
        });
        w.on("close", () => { closed = true; });
        const done = () => {
          console.log(JSON.stringify({
            errorEvent,
            closed,
            openDelivered: seen.has("open/p.txt") || seen.has(path.join("open", "p.txt")),
          }));
          try { w.close(); } catch {}
          clearInterval(poll);
          clearTimeout(deadline);
        };
        const poll = setInterval(() => {
          if (errorEvent && (seen.has("open/p.txt") || seen.has(path.join("open", "p.txt")))) done();
        }, 20);
        const deadline = setTimeout(done, 4000);
      `;
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture],
          env: { ...bunEnv, WATCH_ROOT: root },
          cwd: "/",
          uid: NOBODY,
          gid: NOBODY,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const result = JSON.parse(stdout.trim());
        expect(result.errorEvent).not.toBeNull();
        // internal/fs/watch.ts rewrites EACCES to EPERM for watchpack compat.
        expect(result.errorEvent.code).toBe("EPERM");
        expect(result.errorEvent.syscall).toBe("watch");
        expect(result.errorEvent.path).toContain("locked");
        expect(result.closed).toBe(false);
        expect(result.openDelivered).toBe(true);
        expect(exitCode).toBe(0);

        // fs.promises.watch wraps the native watcher in an async iterator with
        // no user-accessible handle. A subtree-registration error that keeps
        // the native watcher open must not leave it refing the event loop
        // after the iterator throws, or the process hangs at exit.
        const promisesFixture = `
          const fs = require("fs");
          const root = process.env.WATCH_ROOT;
          (async () => {
            let caught = null;
            try {
              for await (const e of fs.promises.watch(root, { recursive: true })) break;
            } catch (e) {
              caught = { code: e.code, syscall: e.syscall, path: e.path };
            }
            console.log(JSON.stringify({ caught }));
          })();
          setTimeout(() => { console.log(JSON.stringify({ hung: true })); process.exit(1); }, 4000).unref();
        `;
        await using proc2 = Bun.spawn({
          cmd: [bunExe(), "-e", promisesFixture],
          env: { ...bunEnv, WATCH_ROOT: root },
          cwd: "/",
          uid: NOBODY,
          gid: NOBODY,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout2, stderr2, exitCode2] = await Promise.all([
          proc2.stdout.text(),
          proc2.stderr.text(),
          proc2.exited,
        ]);
        expect(stderr2).toBe("");
        const result2 = JSON.parse(stdout2.trim());
        expect(result2.hung).toBeUndefined();
        expect(result2.caught).toEqual({
          code: "EACCES",
          syscall: "watch",
          path: path.join(root, "locked"),
        });
        expect(exitCode2).toBe(0);
      } finally {
        fs.chmodSync(path.join(root, "locked"), 0o755);
        for (const [p, mode] of ancestors) fs.chmodSync(p, mode);
      }
    },
  );

  // A directory can sit deeper than PATH_MAX: every component is legal, it just
  // has to be created relative to a cwd that is itself below the limit. The
  // recursive walk used to join such an entry's path into a fixed PATH_MAX
  // buffer and abort the process with a bounds panic, both during the initial
  // walk inside fs.watch() and later on the inotify reader thread when an entry
  // appeared under a watched directory that is close to the limit. inotify
  // cannot watch a path that long (ENAMETOOLONG), so that subtree is reported
  // through the 'error' event like any other registration failure; events whose
  // relative path exceeds PATH_MAX are still delivered and the rest of the tree
  // stays watched. Runs in a subprocess because the unfixed behavior is an abort.
  test.skipIf(!isLinux)("recursive watch survives directories deeper than PATH_MAX", async () => {
    const PATH_MAX = 4096;
    // Absolute length of the deepest directory inotify can still watch. Any
    // entry inside it (names below are NAME_MAX bytes) ends up beyond PATH_MAX.
    const deepLength = PATH_MAX - 16;
    const existingDir = Buffer.alloc(255, "e").toString();
    const createdDir = Buffer.alloc(255, "d").toString();
    const createdFile = Buffer.alloc(255, "f").toString();
    // Only there to dump what did arrive when an event goes missing; the whole
    // scenario takes about a second under ASAN, and CI's per-test timeout is
    // well above this.
    const deadlineMs = isASAN || isDebug ? 30_000 : 10_000;

    using dir = tempDir("fs-watch-deeper-than-path-max", {});

    const fixture = /* js */ `
      const fs = require("fs"), path = require("path");
      const deepLength = ${deepLength};
      const existingDir = ${JSON.stringify(existingDir)};
      const createdDir = ${JSON.stringify(createdDir)};
      const createdFile = ${JSON.stringify(createdFile)};
      const root = fs.realpathSync(process.env.WATCH_ROOT);

      // root/ccc…/ccc…/ppp… with an absolute length of exactly deepLength.
      process.chdir(root);
      const segment = Buffer.alloc(200, "c").toString();
      let length = root.length;
      while (deepLength - length > 1 + 255) {
        fs.mkdirSync(segment);
        process.chdir(segment);
        length += 1 + segment.length;
      }
      const last = Buffer.alloc(deepLength - length - 1, "p").toString();
      fs.mkdirSync(last);
      process.chdir(last);
      const deep = process.cwd();
      const deepRel = path.relative(root, deep);
      // Exists before the watch starts, so the initial walk meets it.
      fs.mkdirSync(existingDir);
      process.chdir(root);

      const events = [], errors = [], waiters = [];
      const settle = () => {
        for (const waiter of waiters.splice(0)) {
          if (waiter.ready()) waiter.resolve();
          else waiters.push(waiter);
        }
      };
      const until = ready => new Promise(resolve => { waiters.push({ ready, resolve }); settle(); });
      const delivered = name => () => events.some(event => event.name === name);

      const watcher = fs.watch(root, { recursive: true }, (type, name) => {
        events.push({ type, name });
        settle();
      });
      watcher.on("error", error => {
        errors.push({ code: error.code, syscall: error.syscall, path: error.path });
        settle();
      });

      const deadline = setTimeout(() => {
        console.log(JSON.stringify({
          timedOut: true,
          errors,
          events: events.map(event => [event.type, String(event.name).length]),
        }));
        process.exit(1);
      }, ${deadlineMs});

      (async () => {
        await until(() => errors.length === 1);

        // Created under a running watch: the absolute path is beyond PATH_MAX
        // (reported), and so is the relative path (delivered).
        process.chdir(deep);
        fs.mkdirSync(createdDir);
        process.chdir(root);
        await until(() => errors.length === 2);
        await until(delivered(path.join(deepRel, createdDir)));

        // Nothing to register for a file; only its relative path is over the limit.
        process.chdir(deep);
        fs.writeFileSync(createdFile, "x");
        process.chdir(root);
        await until(delivered(path.join(deepRel, createdFile)));

        fs.writeFileSync(path.join(root, "shallow.txt"), "x");
        await until(delivered("shallow.txt"));

        clearTimeout(deadline);
        watcher.close();
        console.log(JSON.stringify({ deep, relativeLength: path.join(deepRel, createdFile).length, errors }));
      })();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, WATCH_ROOT: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.deep).toHaveLength(deepLength);
    expect(result.relativeLength).toBeGreaterThan(PATH_MAX);
    expect(result.errors).toEqual([
      { code: "ENAMETOOLONG", syscall: "watch", path: `${result.deep}/${existingDir}` },
      { code: "ENAMETOOLONG", syscall: "watch", path: `${result.deep}/${createdDir}` },
    ]);
    expect(exitCode).toBe(0);
  });

  // The inotify reader thread walks a directory that's moved into a recursive watch.
  test.concurrent.skipIf(!isLinux).each([
    { title: "deeper than the open-file limit", limit: "ulimit -n 64; ", levels: 100 },
    { title: "300 levels deep", limit: "", levels: 300 },
  ])("recursive watch covers a moved-in tree that's $title", async ({ limit, levels }) => {
    using dir = tempDir("fs-watch-deep-move", { "watched": {} });
    const root = String(dir);
    fs.mkdirSync(path.join(root, "src", ...Array(levels).fill("a")), { recursive: true });

    // inotify delivers events in order, so an event for a later action means the earlier step is done.
    const fixture = /* js */ `
      const fs = require("fs"), path = require("path");
      const root = process.env.WATCH_ROOT;
      const watched = path.join(root, "watched");
      const seen = new Set(), errors = [], dirs = [];
      for (let dir = "moved"; dirs.length < ${levels}; ) dirs.push((dir = path.join(dir, "a")));
      const bottomFile = path.join(dirs.at(-1), "f.txt");
      const watcher = fs.watch(watched, { recursive: true }, (type, name) => {
        seen.add(name);
        if (type !== "rename") return;
        if (name === "walked.txt") {
          fs.writeFileSync(path.join(watched, bottomFile), "x");
          fs.writeFileSync(path.join(watched, "last.txt"), "x");
        } else if (name === "last.txt") {
          watcher.close();
          console.log(JSON.stringify({
            unreported: dirs.flatMap((dir, i) => (seen.has(dir) ? [] : [i + 1])),
            bottomFile: seen.has(bottomFile),
            errors,
          }));
        }
      });
      watcher.on("error", error => errors.push(error.code));
      fs.renameSync(path.join(root, "src"), path.join(watched, "moved"));
      fs.writeFileSync(path.join(watched, "walked.txt"), "x");
    `;

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", limit + 'exec "$0" "$@"', bunExe(), "-e", fixture],
      env: { ...bunEnv, WATCH_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ unreported: [], bottomFile: true, errors: [] }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.skipIf(!isLinux)(
    "recursive watch reports a moved-in tree's files and directories in walk order",
    async () => {
      using dir = tempDir("fs-watch-mixed-tree", { "watched": {} });
      const root = String(dir);

      // Creates three levels that each mix files and directories.
      function makeTree(top: string, depth: number) {
        fs.mkdirSync(top, { recursive: true });
        for (const name of ["f0.txt", "f1.txt", "f2.txt"]) fs.writeFileSync(path.join(top, name), "");
        fs.mkdirSync(path.join(top, "empty"));
        if (depth < 2) for (const name of ["sub0", "sub1"]) makeTree(path.join(top, name), depth + 1);
        for (const name of ["g0.txt", "g1.txt"]) fs.writeFileSync(path.join(top, name), "");
      }
      // Returns the entries under `top` in readdir order, each directory before its contents.
      function listTree(top: string, rel: string): string[] {
        return fs.readdirSync(top, { withFileTypes: true }).flatMap(entry => {
          const name = path.join(rel, entry.name);
          return entry.isDirectory() ? [name, ...listTree(path.join(top, entry.name), name)] : [name];
        });
      }
      makeTree(path.join(root, "mixed"), 0);
      const expected = ["mixed", ...listTree(path.join(root, "mixed"), "mixed")];

      const events: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const watcher = fs.watch(path.join(root, "watched"), { recursive: true }, (_type, name) => {
        if (name === "last.txt") resolve();
        else events.push(name!);
      });
      watcher.on("error", reject);
      try {
        fs.renameSync(path.join(root, "mixed"), path.join(root, "watched", "mixed"));
        fs.writeFileSync(path.join(root, "watched", "last.txt"), "x");
        await promise;
      } finally {
        watcher.close();
      }
      expect(events).toEqual(expected);
    },
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
          expect(["new-file.txt", "new-folder.txt"]).toContain(event.filename!);

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
      for await (const _ of watcher);
    })();
    await Bun.sleep(10);
    ac.abort();
    await expect(promise).rejects.toThrow(
      expect.objectContaining({
        name: "AbortError",
        code: "ABORT_ERR",
        message: "The operation was aborted",
        cause: ac.signal.reason,
      }),
    );
  });

  test("Signal aborted before creating the watcher", async () => {
    const filepath = path.join(testDir, "abort.txt");

    const signal = AbortSignal.abort();
    const watcher = fs.promises.watch(filepath, { signal });
    await expect(
      (async () => {
        for await (const _ of watcher);
      })(),
    ).rejects.toThrow(
      expect.objectContaining({
        name: "AbortError",
        code: "ABORT_ERR",
        message: "The operation was aborted",
        cause: signal.reason,
      }),
    );
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

// Node has a different rule for the boolean options of each watch API. The fixture prints what a runtime does with
// each value, and bun has to print what node prints.
// Not concurrent: a debug build needs seconds to start the processes of all the tests at once.
describe("boolean options of fs.watch, fs.promises.watch and fs.watchFile", () => {
  const fixture = path.join(import.meta.dir, "fixtures", "watch-options-fixture.js");
  // macOS and Windows never use node's non-native recursive watcher, the only part of fs.watch that validates.
  const hasNonNativeRecursiveWatcher = !isMacOS && !isWindows;

  // What node v26.3.0 prints for each section of the fixture, off macOS and Windows.
  const nodeOutput = {
    "fs.watch": `
fs.watch(dir, { persistent: undefined }) watches
fs.watch(dir, { persistent: null }) watches
fs.watch(dir, { persistent: true }) watches
fs.watch(dir, { persistent: false }) watches
fs.watch(dir, { persistent: 0 }) watches
fs.watch(dir, { persistent: 1 }) watches
fs.watch(dir, { persistent: NaN }) watches
fs.watch(dir, { persistent: "" }) watches
fs.watch(dir, { persistent: "yes" }) watches
fs.watch(dir, { persistent: {} }) watches
fs.watch(dir, { recursive: undefined }) watches
fs.watch(dir, { recursive: null }) watches
fs.watch(dir, { recursive: true }) watches
fs.watch(dir, { recursive: false }) watches
fs.watch(dir, { recursive: 0 }) watches
fs.watch(dir, { recursive: 1 }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type number (1)
fs.watch(dir, { recursive: NaN }) watches
fs.watch(dir, { recursive: "" }) watches
fs.watch(dir, { recursive: "yes" }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type string ('yes')
fs.watch(dir, { recursive: {} }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received an instance of Object
fs.watch(dir, { recursive: true, persistent: undefined }) watches
fs.watch(dir, { recursive: true, persistent: null }) watches
fs.watch(dir, { recursive: true, persistent: true }) watches
fs.watch(dir, { recursive: true, persistent: false }) watches
fs.watch(dir, { recursive: true, persistent: 0 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (0)
fs.watch(dir, { recursive: true, persistent: 1 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (1)
fs.watch(dir, { recursive: true, persistent: NaN }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (NaN)
fs.watch(dir, { recursive: true, persistent: "" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('')
fs.watch(dir, { recursive: true, persistent: "yes" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('yes')
fs.watch(dir, { recursive: true, persistent: {} }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received an instance of Object
fs.watch(dir, 123) throws ERR_INVALID_ARG_TYPE: The "options" argument must be one of type string or object. Received type number (123)
fs.watch(dir, "buffer") watches
fs.watch(dir, null) watches
`,
    "fs.watch order": `
fs.watch(123, { recursive: "yes" }) throws ERR_INVALID_ARG_TYPE about path
fs.watch(dir, { recursive: "yes", encoding: "bogus" }) throws ERR_INVALID_ARG_VALUE
fs.watch(dir, { recursive: "yes", signal: "bad" }) throws ERR_INVALID_ARG_TYPE about options.signal
fs.watch(dir, { recursive: "yes", persistent: "x" }) throws ERR_INVALID_ARG_TYPE about options.recursive
fs.watch(dir, { recursive: "yes", ignore: 123 }) throws ERR_INVALID_ARG_TYPE about options.recursive
`,
    "fs.promises.watch order": `
fs.promises.watch(dir, { recursive: "yes", persistent: "x" }) throws ERR_INVALID_ARG_TYPE about options.recursive
fs.promises.watch(pathWithNul, { persistent: 1 }) throws ERR_INVALID_ARG_VALUE
fs.promises.watch(pathWithNul, { recursive: 0 }) throws ERR_INVALID_ARG_TYPE about options.recursive
fs.promises.watch(pathWithNul, { recursive: true, persistent: 1 }) throws ERR_INVALID_ARG_TYPE about options.persistent
fs.promises.watch(pathWithNul, 1) throws ERR_INVALID_ARG_TYPE about options
`,
    "fs.promises.watch": `
fs.promises.watch(dir, { persistent: undefined }) watches
fs.promises.watch(dir, { persistent: null }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received null
fs.promises.watch(dir, { persistent: true }) watches
fs.promises.watch(dir, { persistent: false }) watches
fs.promises.watch(dir, { persistent: 0 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (0)
fs.promises.watch(dir, { persistent: 1 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (1)
fs.promises.watch(dir, { persistent: NaN }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (NaN)
fs.promises.watch(dir, { persistent: "" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('')
fs.promises.watch(dir, { persistent: "yes" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('yes')
fs.promises.watch(dir, { persistent: {} }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received an instance of Object
fs.promises.watch(dir, { recursive: undefined }) watches
fs.promises.watch(dir, { recursive: null }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received null
fs.promises.watch(dir, { recursive: true }) watches
fs.promises.watch(dir, { recursive: false }) watches
fs.promises.watch(dir, { recursive: 0 }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type number (0)
fs.promises.watch(dir, { recursive: 1 }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type number (1)
fs.promises.watch(dir, { recursive: NaN }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type number (NaN)
fs.promises.watch(dir, { recursive: "" }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type string ('')
fs.promises.watch(dir, { recursive: "yes" }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received type string ('yes')
fs.promises.watch(dir, { recursive: {} }) throws ERR_INVALID_ARG_TYPE: The "options.recursive" property must be of type boolean. Received an instance of Object
fs.promises.watch(dir, { recursive: true, persistent: undefined }) watches
fs.promises.watch(dir, { recursive: true, persistent: null }) watches
fs.promises.watch(dir, { recursive: true, persistent: true }) watches
fs.promises.watch(dir, { recursive: true, persistent: false }) watches
fs.promises.watch(dir, { recursive: true, persistent: 0 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (0)
fs.promises.watch(dir, { recursive: true, persistent: 1 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (1)
fs.promises.watch(dir, { recursive: true, persistent: NaN }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (NaN)
fs.promises.watch(dir, { recursive: true, persistent: "" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('')
fs.promises.watch(dir, { recursive: true, persistent: "yes" }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type string ('yes')
fs.promises.watch(dir, { recursive: true, persistent: {} }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received an instance of Object
fs.promises.watch(dir, { persistent: 1, signal: AbortSignal.abort() }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (1)
fs.promises.watch(dir, { persistent: 1, ignore: 123 }) throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received type number (1)
fs.promises.watch(dir, 1) throws ERR_INVALID_ARG_TYPE: The "options" argument must be of type object. Received type number (1)
`,
    "fs.watchFile": `
fs.watchFile(file, { bigint: undefined }, listener) gives Stats
fs.watchFile(file, { bigint: null }, listener) gives Stats
fs.watchFile(file, { bigint: true }, listener) gives BigIntStats
fs.watchFile(file, { bigint: false }, listener) gives Stats
fs.watchFile(file, { bigint: 0 }, listener) gives Stats
fs.watchFile(file, { bigint: 1 }, listener) gives Stats
fs.watchFile(file, { bigint: NaN }, listener) gives Stats
fs.watchFile(file, { bigint: "" }, listener) gives Stats
fs.watchFile(file, { bigint: "yes" }, listener) gives Stats
fs.watchFile(file, { bigint: {} }, listener) gives Stats
fs.watchFile(file, Object.create({ bigint: true }), listener) gives Stats
`,
    // Whether the watcher keeps a process alive. A row is the source of the call, as the fixture runs it.
    // It is an argument of the fixture, so it has no double quote: a Windows command line has to escape one.
    "fs.watch keep-alive": `
fs.watch(dir) keeps the process alive
fs.watch(dir, { persistent: true }) keeps the process alive
fs.watch(dir, { persistent: false }) lets the process exit
fs.watch(dir, { persistent: null }) lets the process exit
fs.watch(dir, { persistent: '' }) lets the process exit
fs.watch(dir, { persistent: 0 }) lets the process exit
fs.watch(dir, { persistent: 1 }) lets the process exit
fs.watch(dir, { recursive: true, persistent: null }) lets the process exit
fs.watch(dir, { persistent: false }).ref() keeps the process alive
`,
    "fs.promises.watch keep-alive": `
fs.promises.watch(dir, { signal }) keeps the process alive
fs.promises.watch(dir, { signal, persistent: false }) lets the process exit
fs.promises.watch(dir, { signal, recursive: true }) keeps the process alive
fs.promises.watch(dir, { signal, persistent: false, recursive: true }) lets the process exit
fs.promises.watch(dir, { signal, recursive: true, persistent: null }) lets the process exit
`,
    "fs.watchFile keep-alive": `
fs.watchFile(file, {}, listener) keeps the process alive
fs.watchFile(file, { persistent: undefined }, listener) lets the process exit
fs.watchFile(file, { persistent: true }, listener) keeps the process alive
fs.watchFile(file, { persistent: false }, listener) lets the process exit
fs.watchFile(file, { persistent: null }, listener) lets the process exit
fs.watchFile(file, { persistent: 0 }, listener) lets the process exit
fs.watchFile(file, { persistent: 1 }, listener) keeps the process alive
fs.watchFile(file, Object.create({ persistent: false }), listener) keeps the process alive
`,
  };

  // On macOS and Windows node v26.3.0 checks the path first, and `persistent` before `recursive`:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L378-L393
  const onMacOSAndWindows: Partial<Record<keyof typeof nodeOutput, Record<string, string>>> = {
    "fs.promises.watch order": {
      'fs.promises.watch(dir, { recursive: "yes", persistent: "x" })':
        "throws ERR_INVALID_ARG_TYPE about options.persistent",
      "fs.promises.watch(pathWithNul, { recursive: 0 })": "throws ERR_INVALID_ARG_VALUE",
      "fs.promises.watch(pathWithNul, { recursive: true, persistent: 1 })": "throws ERR_INVALID_ARG_VALUE",
      "fs.promises.watch(pathWithNul, 1)": "throws ERR_INVALID_ARG_VALUE",
    },
  };

  // Bun keeps what main does with an input that main accepts. Each row here is a difference from node on at
  // least one platform. Node's outcome is in `nodeOutput`. Delete a row to make bun follow node there.
  const keptFromMain: Partial<Record<keyof typeof nodeOutput, Record<string, string>>> = {
    "fs.watch": {
      'fs.watch(dir, { recursive: true, persistent: "" })': "watches",
    },
    "fs.promises.watch": {
      "fs.promises.watch(dir, { persistent: null })": "watches",
      'fs.promises.watch(dir, { persistent: "" })': "watches",
      "fs.promises.watch(dir, { recursive: null })": "watches",
      'fs.promises.watch(dir, { recursive: "" })': "watches",
      "fs.promises.watch(dir, { recursive: true, persistent: null })": "watches",
      'fs.promises.watch(dir, { recursive: true, persistent: "" })': "watches",
    },
    "fs.watchFile": {
      "fs.watchFile(file, Object.create({ bigint: true }), listener)": "gives BigIntStats",
    },
    "fs.watch keep-alive": {
      "fs.watch(dir, { persistent: null })": "keeps the process alive",
      "fs.watch(dir, { persistent: '' })": "keeps the process alive",
      "fs.watch(dir, { recursive: true, persistent: null })": "keeps the process alive",
    },
    "fs.promises.watch keep-alive": {
      "fs.promises.watch(dir, { signal, recursive: true, persistent: null })": "keeps the process alive",
    },
    "fs.watchFile keep-alive": {
      "fs.watchFile(file, { persistent: undefined }, listener)": "keeps the process alive",
      "fs.watchFile(file, Object.create({ persistent: false }), listener)": "lets the process exit",
    },
  };

  function expectedOutput(section: keyof typeof nodeOutput, runtime: "bun" | "node") {
    let lines = nodeOutput[section].trimStart().split("\n");
    const replaceRows = (rows: Record<string, string> = {}) => {
      for (const [row, outcome] of Object.entries(rows)) {
        const index = lines.findIndex(line => line.startsWith(row + " "));
        expect(index).not.toBe(-1);
        lines[index] = `${row} ${outcome}`;
      }
    };
    if (!hasNonNativeRecursiveWatcher) {
      // The native watcher takes any value. The generator of fs.promises.watch does not take a null `persistent`.
      lines = lines.map(line =>
        line
          .replace(/^(fs\.watch\(dir, \{ recursive: .*\}\)) throws .*$/, "$1 watches")
          .replace(
            /^(fs\.promises\.watch\(dir, \{ recursive: true, persistent: null \}\)) watches$/,
            '$1 throws ERR_INVALID_ARG_TYPE: The "options.persistent" property must be of type boolean. Received null',
          ),
      );
      replaceRows(onMacOSAndWindows[section]);
    }
    if (runtime === "bun") replaceRows(keptFromMain[section]);
    return lines.join("\n");
  }

  // A real node of the version that bun reports to be. Another version can have other rules.
  const node = (() => {
    const exe = nodeExe();
    if (!exe) return null;
    const version = "process.versions.bun ? '' : process.versions.node";
    const { stdout } = Bun.spawnSync({ cmd: [exe, "-p", version], env: bunEnv, stderr: "ignore" });
    return stdout.toString().trim() === process.versions.node ? exe : null;
  })();

  async function run(exe: string, ...args: string[]) {
    using dir = tempDir("watch-options", {});
    await using proc = Bun.spawn({
      cmd: [exe, fixture, String(dir), ...args],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  for (const [runtime, exe] of [
    ["bun", bunExe()],
    ["node", node],
  ] as const) {
    for (const section of Object.keys(nodeOutput) as (keyof typeof nodeOutput)[]) {
      // In fs.watch only node's non-native recursive watcher has an order of checks to follow.
      test.skipIf(!exe || (section === "fs.watch order" && !hasNonNativeRecursiveWatcher))(
        `${section} (${runtime})`,
        async () => {
          const expected = expectedOutput(section, runtime);
          if (!section.endsWith(" keep-alive")) {
            expect(await run(exe!, section)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
            return;
          }
          // The fixture opens the watchers that keep it alive, one at a time, and prints each one that does.
          // Then it opens all the other watchers at once, and has to exit with nothing more printed.
          const rows = (outcome: string) =>
            expected
              .split("\n")
              .filter(line => line.endsWith(` ${outcome}`))
              .map(line => line.slice(0, -outcome.length - 1));
          const keeps = rows("keeps the process alive");
          const exits = rows("lets the process exit");
          expect(keeps.length + exits.length).toBe(expected.trimEnd().split("\n").length);
          expect(await run(exe!, "keep-alive", ...keeps, "--", ...exits)).toEqual({
            stdout: keeps.map(row => row + "\n").join(""),
            stderr: "",
            exitCode: 0,
          });
        },
      );
    }
  }

  // The native lookups that these options had stopped at Object.prototype, and asked a Proxy. The lookups in JS
  // do the same.
  test("an inherited option counts, unless it is inherited from Object.prototype", () => {
    class Accessor {
      get encoding() {
        return "bogus";
      }
      get persistent() {
        return 1;
      }
    }
    const inherited = {
      "Object.create": () => Object.create({ encoding: "bogus", persistent: 1 }),
      "class accessor": () => new Accessor(),
      "non-enumerable": () => Object.defineProperties({}, { encoding: { value: "bogus" }, persistent: { value: 1 } }),
      "Proxy get trap": () =>
        new Proxy({}, { get: (_, key) => ({ __proto__: null, encoding: "bogus", persistent: 1 })[key] }),
      // Object.hasOwn() does not find these options on this object, and a get does.
      "vm context global": () =>
        vm.runInContext("this", vm.createContext(Object.create({ encoding: "bogus", persistent: 1 }))),
    };
    const code = (run: () => FSWatcher | AsyncIterable<unknown>) => {
      try {
        const watcher = run();
        if ("close" in watcher) watcher.close();
        else void watcher[Symbol.asyncIterator]().return?.();
        return "watches";
      } catch (e: any) {
        return e.code;
      }
    };
    const outcomes = {};
    for (const [label, options] of Object.entries(inherited)) {
      outcomes[`fs.watch ${label}`] = code(() => fs.watch(testDir, options()));
      outcomes[`fs.promises.watch ${label}`] = code(() => fs.promises.watch(testDir, options()));
    }
    expect(outcomes).toEqual({
      "fs.watch Object.create": "ERR_INVALID_ARG_VALUE",
      "fs.promises.watch Object.create": "ERR_INVALID_ARG_TYPE",
      "fs.watch class accessor": "ERR_INVALID_ARG_VALUE",
      "fs.promises.watch class accessor": "ERR_INVALID_ARG_TYPE",
      "fs.watch non-enumerable": "ERR_INVALID_ARG_VALUE",
      "fs.promises.watch non-enumerable": "ERR_INVALID_ARG_TYPE",
      "fs.watch Proxy get trap": "ERR_INVALID_ARG_VALUE",
      "fs.promises.watch Proxy get trap": "ERR_INVALID_ARG_TYPE",
      "fs.watch vm context global": "ERR_INVALID_ARG_VALUE",
      "fs.promises.watch vm context global": "ERR_INVALID_ARG_TYPE",
    });

    const notRead = {};
    for (const [key, value] of Object.entries({ persistent: 1, recursive: "yes", encoding: "bogus", signal: "bad" })) {
      Object.prototype[key] = value;
      try {
        notRead[`fs.watch ${key}`] = code(() => fs.watch(testDir, {}));
        // fs.promises.watch reads `signal` with a plain get, on main too.
        if (key !== "signal") notRead[`fs.promises.watch ${key}`] = code(() => fs.promises.watch(testDir, {}));
      } finally {
        delete Object.prototype[key];
      }
    }
    expect(notRead).toEqual({
      "fs.watch persistent": "watches",
      "fs.promises.watch persistent": "watches",
      "fs.watch recursive": "watches",
      "fs.promises.watch recursive": "watches",
      "fs.watch encoding": "watches",
      "fs.promises.watch encoding": "watches",
      "fs.watch signal": "watches",
    });

    // A Proxy answers for itself, also when Object.prototype has the key.
    Object.prototype["encoding"] = "utf8";
    try {
      expect(code(() => fs.watch(testDir, inherited["Proxy get trap"]()))).toBe("ERR_INVALID_ARG_VALUE");
    } finally {
      delete Object.prototype["encoding"];
    }
  });

  // Off macOS and Windows a truthy `recursive` other than `true` throws before it reaches the native watcher.
  test.skipIf(hasNonNativeRecursiveWatcher)("fs.watch with `recursive: 1` is not recursive", async () => {
    using dir = tempDir("watch-recursive-1", { "root.txt": "a", "sub": { "nested.txt": "a" } });
    const root = String(dir);
    const seen: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let rootEvents = 0;
    const watcher = fs.watch(root, { recursive: 1 as any }, (_, filename) => {
      seen.push(String(filename));
      if (path.basename(String(filename)) === "root.txt" && ++rootEvents === 3) resolve();
    });
    watcher.on("error", reject);
    // A recursive watcher reports the nested file before the third event of the file next to it.
    const interval = repeat(() => {
      for (const file of [path.join(root, "sub", "nested.txt"), path.join(root, "root.txt")]) {
        fs.rmSync(file, { force: true });
        fs.writeFileSync(file, "a");
      }
    });
    try {
      await promise;
    } finally {
      clearInterval(interval);
      watcher.close();
    }
    expect(seen.filter(filename => path.basename(filename) === "nested.txt")).toEqual([]);
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
        const rss = process.memoryUsage.rss;

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
        const before = rss();

        // With a ~700-byte resolved path, 5000 leaked dupeZ buffers is
        // ~3.5 MB of growth on unpatched builds. Keep the iteration count
        // low enough that rapid FSEventStream recreate doesn't exhaust the
        // kernel queue (FSEventStreamCreate -> NULL).
        await cycle(5000);
        const after = rss();

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

// Watching a file symlink makes bun hand libuv the readlink() result, which for
// a relative link target is a bare file name. libuv's uv__split_path() used to
// _wcsdup() that name from the CRT heap while everything else it owns comes
// from uv__malloc(), i.e. from mimalloc (uv_replace_allocator in main), so
// closing the watcher handed a CRT pointer to mi_free. Debug builds report that
// on stderr every time ("mimalloc: error: mi_free: invalid pointer"); release
// builds segfault in roughly half of all processes, depending on where ASLR put
// the CRT heap relative to mimalloc's page map, hence several children.
// Fixed in oven-sh/libuv#14.
test.skipIf(!isWindows)("closing a watcher on a symlink with a relative target does not crash (windows)", async () => {
  using dir = tempDir("fswatch-relative-symlink", { "target.txt": "hello" });
  const base = String(dir);
  // The target must be relative. File symlinks need the symlink privilege,
  // which the Windows CI agents have (fs.test.ts creates them too).
  fs.symlinkSync("target.txt", path.join(base, "link.txt"), "file");
  expect(fs.readlinkSync(path.join(base, "link.txt"))).toBe("target.txt");

  const fixture = /* js */ `
    const { watch } = require("node:fs");
    const watcher = watch("link.txt", () => {});
    watcher.once("close", () => console.log("OK"));
    watcher.close();
  `;

  const runs = await Promise.all(
    Array.from({ length: 6 }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        // libuv resolves the bare target name against the cwd, so the watch
        // only reaches the affected code path when started from the link's
        // directory.
        cwd: base,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }),
  );

  expect(runs).toEqual(runs.map(() => ({ stdout: "OK", stderr: "", exitCode: 0 })));
});
