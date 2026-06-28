import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "path";

// `Bun.FileIndex({ watch: true })` is implemented on Linux (inotify), macOS
// (FSEvents) and Windows (libuv); only Linux and macOS are exercised in CI
// today because the Windows backend cannot register watches until the
// initial crawl completes and has had no native verification yet.
const watchSupported = !process.platform.startsWith("win");

type ChangeEvent = { kind: "create" | "modify" | "delete"; path: string };

/** Accumulates onchange batches and lets a test await a condition on them. */
function collect(index: Bun.FileIndex) {
  const events: ChangeEvent[] = [];
  const batches: ChangeEvent[][] = [];
  let waiters: Array<{ pred: (events: ChangeEvent[]) => boolean; resolve: (e: ChangeEvent[]) => void }> = [];
  index.onchange = batch => {
    batches.push(batch);
    events.push(...batch);
    waiters = waiters.filter(w => {
      if (!w.pred(events)) return true;
      w.resolve([...events]);
      return false;
    });
  };
  return {
    events,
    batches,
    /** Resolves with all events seen once `pred` holds. Never polls. */
    until(pred: (events: ChangeEvent[]) => boolean): Promise<ChangeEvent[]> {
      return new Promise(resolve => {
        if (pred(events)) return resolve([...events]);
        waiters.push({ pred, resolve });
      });
    },
  };
}

const has = (kind: ChangeEvent["kind"], path: string) => (events: ChangeEvent[]) =>
  events.some(e => e.kind === kind && e.path === path);

describe.skipIf(!watchSupported)("Bun.FileIndex watch", () => {
  test("watching reflects reality and close() is idempotent", async () => {
    using dir = tempDir("fi-watch-basic", { "a.txt": "a" });
    {
      using plain = new Bun.FileIndex(String(dir));
      expect(plain.watching).toBe(false);
    }
    using index = new Bun.FileIndex(String(dir), { watch: true });
    expect(index.watching).toBe(true);
    await index.ready;
    expect(index.watching).toBe(true);
    index.close();
    expect(index.watching).toBe(false);
    index.close();
    expect(index.watching).toBe(false);
  });

  test("create, modify, delete produce batched events and the index is updated first", async () => {
    using dir = tempDir("fi-watch-cmd", { "a.txt": "a" });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    // Every observation below is made from inside the callback, so the test
    // proves the index was updated *before* onchange fired.
    const observed: Record<string, unknown> = {};
    const c = collect(index);
    const inner = index.onchange!;
    index.onchange = batch => {
      for (const { kind, path } of batch) observed[`${kind}:${path}`] = index.stat(path);
      inner(batch);
    };

    await Bun.write(join(String(dir), "b.txt"), "bb");
    await c.until(has("create", "b.txt"));
    expect(observed["create:b.txt"]).toMatchObject({ kind: "file", size: 2 });

    await Bun.write(join(String(dir), "b.txt"), "bbbb");
    await c.until(has("modify", "b.txt"));
    expect(observed["modify:b.txt"]).toMatchObject({ kind: "file", size: 4 });

    await Bun.file(join(String(dir), "b.txt")).unlink();
    await c.until(has("delete", "b.txt"));
    expect(observed["delete:b.txt"]).toBeNull();
    expect(index.has("b.txt")).toBe(false);
    // The pre-existing entry was never disturbed.
    expect(index.has("a.txt")).toBe(true);
  });

  test("events inside an ignored directory never fire and cost no event", async () => {
    using dir = tempDir("fi-watch-ignored", {
      ".gitignore": "ignored/\n*.log\n",
      "ignored/keep": "x",
      "src/a.ts": "1",
    });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    expect(index.has("ignored")).toBe(false);
    const c = collect(index);

    // Touch ignored paths first, then a non-ignored one. The visible event
    // for the latter bounds the wait; nothing about the former may show up.
    await Bun.write(join(String(dir), "ignored", "inside.txt"), "x");
    await Bun.write(join(String(dir), "build.log"), "x");
    await Bun.write(join(String(dir), "src", "b.ts"), "2");
    const events = await c.until(has("create", "src/b.ts"));
    expect(events).toEqual([{ kind: "create", path: "src/b.ts" }]);
    expect(index.has("ignored/inside.txt")).toBe(false);
    expect(index.has("build.log")).toBe(false);
  });

  test("a brand-new directory tree is watched and its contents indexed", async () => {
    using dir = tempDir("fi-watch-tree", { "root.txt": "r" });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    const c = collect(index);

    await Bun.write(join(String(dir), "pkg", "src", "deep", "x.ts"), "x");
    await c.until(has("create", "pkg/src/deep/x.ts"));
    for (const path of ["pkg", "pkg/src", "pkg/src/deep", "pkg/src/deep/x.ts"]) {
      expect(index.has(path)).toBe(true);
    }
    expect(index.stat("pkg/src/deep")!.kind).toBe("dir");

    // The new directory has a live OS watch: later writes inside it fire.
    await Bun.write(join(String(dir), "pkg", "src", "deep", "y.ts"), "y");
    await c.until(has("create", "pkg/src/deep/y.ts"));
    expect(index.has("pkg/src/deep/y.ts")).toBe(true);
  });

  test("renames are reported as delete + create and deleted directories drop their descendants", async () => {
    using dir = tempDir("fi-watch-rename", {
      "old.txt": "1",
      "tree/a.txt": "a",
      "tree/sub/b.txt": "b",
    });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    const c = collect(index);

    await rename(join(String(dir), "old.txt"), join(String(dir), "new.txt"));
    await c.until(e => has("create", "new.txt")(e) && has("delete", "old.txt")(e));
    expect(index.has("old.txt")).toBe(false);
    expect(index.has("new.txt")).toBe(true);

    await rm(join(String(dir), "tree"), { recursive: true });
    await c.until(has("delete", "tree"));
    const deleted = c.events
      .filter(e => e.kind === "delete")
      .map(e => e.path)
      .sort();
    expect(deleted).toEqual(["old.txt", "tree", "tree/a.txt", "tree/sub", "tree/sub/b.txt"]);
    expect(index.glob("tree/**")).toEqual([]);
  });

  test("a .gitignore edit re-crawls: newly-ignored files disappear with delete events", async () => {
    using dir = tempDir("fi-watch-gitignore", {
      ".gitignore": "*.tmp\n",
      "src/a.ts": "a",
      "src/gen.out": "g",
    });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    expect(index.has("src/gen.out")).toBe(true);
    const c = collect(index);

    // Re-crawl events are a pure index diff: `*.out` files disappear, and the
    // changed `.gitignore` itself is reported by the regular watch path.
    await Bun.write(join(String(dir), ".gitignore"), "*.tmp\n*.out\n");
    await c.until(has("delete", "src/gen.out"));
    expect(index.has("src/gen.out")).toBe(false);
    expect(index.has("src/a.ts")).toBe(true);

    // The new rule is also live in the watcher: a fresh `.out` file under an
    // already-watched directory produces no event, while a `.ts` file does.
    await Bun.write(join(String(dir), "src", "other.out"), "x");
    await Bun.write(join(String(dir), "src", "z.ts"), "z");
    await c.until(has("create", "src/z.ts"));
    expect(index.has("src/other.out")).toBe(false);
    expect(c.events.some(e => e.path === "src/other.out")).toBe(false);
  });

  test("many rapid writes coalesce into batches with no lost final state", async () => {
    using dir = tempDir("fi-watch-burst", {});
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    const c = collect(index);
    const count = 200;
    for (let i = 0; i < count; i++) {
      await Bun.write(join(String(dir), `f${i}.txt`), String(i));
    }
    await c.until(events => {
      const created = new Set(events.filter(e => e.kind !== "delete").map(e => e.path));
      for (let i = 0; i < count; i++) if (!created.has(`f${i}.txt`)) return false;
      return true;
    });
    // Coalesced: far fewer batches than filesystem operations.
    expect(c.batches.length).toBeGreaterThanOrEqual(1);
    expect(c.batches.length).toBeLessThan(count);
    // Each batch is deduplicated per path.
    for (const batch of c.batches) {
      const paths = batch.map(e => e.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
    expect(index.size).toBe(count);
  });

  test("refresh() on a watching index resolves and keeps the watcher live", async () => {
    using dir = tempDir("fi-watch-refresh", { "a.txt": "a" });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    // Mutate the tree behind the watcher's back is not needed here: refresh
    // must re-register and keep delivering events afterwards.
    expect(await index.refresh()).toBe(index);
    const c = collect(index);
    await Bun.write(join(String(dir), "post-refresh.txt"), "x");
    await c.until(has("create", "post-refresh.txt"));
    expect(index.has("post-refresh.txt")).toBe(true);
  });

  test("two independent indexes over the same tree both receive events", async () => {
    using dir = tempDir("fi-watch-two", { "seed.txt": "s" });
    using a = new Bun.FileIndex(String(dir), { watch: true });
    using b = new Bun.FileIndex(String(dir), { watch: true });
    await Promise.all([a.ready, b.ready]);
    const ca = collect(a);
    const cb = collect(b);
    await Bun.write(join(String(dir), "shared.txt"), "x");
    await Promise.all([ca.until(has("create", "shared.txt")), cb.until(has("create", "shared.txt"))]);
    expect(a.has("shared.txt")).toBe(true);
    expect(b.has("shared.txt")).toBe(true);
  });

  test("close() stops events; a closed index delivers nothing pending", async () => {
    using dir = tempDir("fi-watch-close", { "a.txt": "a" });
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    let fired = 0;
    index.onchange = () => void fired++;
    index.close();
    expect(index.watching).toBe(false);
    // The watcher thread is joined by close(), so nothing can fire later.
    await Bun.write(join(String(dir), "after.txt"), "x");
    // Bound the negative with a second, observable watcher over the same dir.
    using probe = new Bun.FileIndex(String(dir), { watch: true });
    await probe.ready;
    const c = collect(probe);
    await Bun.write(join(String(dir), "bound.txt"), "x");
    await c.until(has("create", "bound.txt"));
    expect(fired).toBe(0);
    expect(() => index.size).not.toThrow();
    expect(() => index.complete("a")).toThrow("closed");
  });

  test("Symbol.dispose closes a watching index", async () => {
    using dir = tempDir("fi-watch-dispose", { "a.txt": "a" });
    let leaked!: Bun.FileIndex;
    {
      using index = new Bun.FileIndex(String(dir), { watch: true });
      await index.ready;
      leaked = index;
      expect(index.watching).toBe(true);
    }
    expect(leaked.watching).toBe(false);
  });

  test("onchange is a writable property and an accepted constructor option", async () => {
    using dir = tempDir("fi-watch-prop", {});
    const cb = (events: ChangeEvent[]) => void events;
    using index = new Bun.FileIndex(String(dir), { watch: true, onchange: cb });
    expect(index.onchange).toBe(cb);
    index.onchange = null;
    expect(index.onchange).toBeNull();
    await index.ready;
    // @ts-expect-error non-callable onchange option
    expect(() => new Bun.FileIndex(String(dir), { onchange: 42 })).toThrow("function");
  });

  test("a watching index with no references survives GC until close()", async () => {
    using dir = tempDir("fi-watch-gc", { "a.txt": "a" });
    let weak!: WeakRef<Bun.FileIndex>;
    let collected = false;
    const registry = new FinalizationRegistry(() => void (collected = true));
    const firstBatch = Promise.withResolvers<ChangeEvent[]>();
    {
      let index: Bun.FileIndex | null = new Bun.FileIndex(String(dir), {
        watch: true,
        onchange: events => firstBatch.resolve(events),
      });
      registry.register(index, "file-index");
      weak = new WeakRef(index);
      await index.ready;
      index = null;
    }
    Bun.gc(true);
    await Bun.write(join(String(dir), "gc.txt"), "x");
    // The watcher still fires after a full GC with no live references.
    expect(await firstBatch.promise).toEqual([{ kind: "create", path: "gc.txt" }]);
    Bun.gc(true);
    expect(collected).toBe(false);
    const alive = weak.deref();
    expect(alive).toBeDefined();
    expect(alive!.has("gc.txt")).toBe(true);
    alive!.close();
  });

  // A throwing handler surfaces as an uncaught exception (nonzero exit code,
  // reported on stderr) without breaking the watcher or skipping later
  // batches, so it runs in a subprocess.
  test("a throwing onchange is reported and does not kill the watcher", async () => {
    using dir = tempDir("fi-watch-throw", {
      "main.ts": `
        const root = process.argv[2];
        const index = new Bun.FileIndex(root, { watch: true });
        await index.ready;
        let calls = 0;
        const first = Promise.withResolvers();
        const second = Promise.withResolvers();
        index.onchange = events => {
          calls++;
          console.log(JSON.stringify(events));
          if (calls === 1) {
            first.resolve();
            throw new Error("boom from onchange");
          }
          second.resolve();
        };
        await Bun.write(root + "/one.txt", "1");
        await first.promise;
        // A second burst, sequenced strictly after the throwing delivery.
        await Bun.write(root + "/two.txt", "2");
        await second.promise;
        console.log("second batch delivered");
        index.close();
      `,
    });
    using watched = tempDir("fi-watch-throw-root", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "main.ts"), String(watched)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain('[{"kind":"create","path":"one.txt"}]');
    expect(stdout).toContain('[{"kind":"create","path":"two.txt"}]');
    expect(stdout).toContain("second batch delivered");
    expect(stderr).toContain("boom from onchange");
    // The uncaught exception sets the exit code; the watcher kept running.
    expect(exitCode).toBe(1);
  });

  test("a watching index keeps the process alive until close()", async () => {
    // The child's last statement leaves ONLY the watching index alive: no
    // stdin listener, no timer. The parent then proves the child is still
    // alive AND processing (an `onchange` round-trip through its stdout
    // strictly after "end of script"), then makes it close() — via another
    // watcher event, the only channel it has — and awaits a clean exit 0.
    using dir = tempDir("fi-watch-keepalive", {
      "main.ts": `
        const index = new Bun.FileIndex(process.argv[2], { watch: true });
        index.onchange = events => {
          for (const e of events) {
            console.log("EV " + e.kind + " " + e.path);
            if (e.path === "please-close") index.close();
          }
        };
        await index.ready;
        if (process.argv[3] === "close") index.close();
        console.log("end of script");
      `,
    });
    using watched = tempDir("fi-watch-keepalive-root", {});

    // close() before the end of the script: the process must exit on its own.
    const closed = Bun.spawnSync({
      cmd: [bunExe(), join(String(dir), "main.ts"), String(watched), "close"],
      env: bunEnv,
    });
    expect(closed.stdout.toString()).toBe("end of script\n");
    expect(closed.exitCode).toBe(0);

    // Without close(), the watcher refs the event loop past the last statement.
    await using open = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "main.ts"), String(watched)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = (async function* () {
      let buffered = "";
      for await (const chunk of open.stdout) {
        buffered += Buffer.from(chunk).toString();
        let nl: number;
        while ((nl = buffered.indexOf("\n")) !== -1) {
          yield buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
        }
      }
    })();
    // Pulls with `next()` (a `for await` + `return` would close the shared
    // generator and cancel the child's stdout for the later waits).
    const until = async (pred: (line: string) => boolean) => {
      while (true) {
        const { value, done } = await lines.next();
        if (done) throw new Error("child stdout ended before the expected line");
        if (pred(value)) return value;
      }
    };
    await until(line => line === "end of script");
    // The script body has ended; the event loop must still be alive and the
    // watcher still delivering: a write is observed via onchange afterwards.
    await Bun.write(join(String(watched), "alive-probe.txt"), "x");
    await until(line => line === "EV create alive-probe.txt");
    // Now make the child call close(); with the watcher gone, nothing keeps
    // the process alive and it must exit 0 on its own (not be killed).
    await Bun.write(join(String(watched), "please-close"), "x");
    expect(await open.exited).toBe(0);
    expect(open.signalCode).toBeNull();
  });
});

describe.skipIf(!isLinux)("Bun.FileIndex watch (linux specifics)", () => {
  test("ignored directories never get an inotify watch", async () => {
    using dir = tempDir("fi-watch-fdcount", {
      ".gitignore": "node_modules/\n",
      "src/index.ts": "x",
    });
    const fdInfo = async (pid: number) => {
      let watched = 0;
      for (const fd of await readdir(`/proc/${pid}/fdinfo`)) {
        const info = await readFile(`/proc/${pid}/fdinfo/${fd}`, "utf8").catch(() => "");
        watched += info.split("\n").filter(line => line.startsWith("inotify wd:")).length;
      }
      return watched;
    };
    // 200 directories under an ignored tree must not consume inotify watches.
    for (let i = 0; i < 200; i++) {
      await Bun.write(join(String(dir), "node_modules", `pkg${i}`, "index.js"), "x");
    }
    // Other inotify instances exist in the test process; measure the delta
    // this index contributes.
    const before = await fdInfo(process.pid);
    using index = new Bun.FileIndex(String(dir), { watch: true });
    await index.ready;
    const c = collect(index);
    await Bun.write(join(String(dir), "src", "probe.ts"), "p");
    await c.until(has("create", "src/probe.ts"));
    const added = (await fdInfo(process.pid)) - before;
    // Exactly the root + `src`; none of the 201 ignored directories.
    expect(added).toBe(2);
  });
});
