// Tests that exercise the decoupled fs.watch backend (src/bun.js/node/path_watcher.zig),
// which no longer routes through bun.Watcher.
//
// The old backend piggy-backed on the bundler's watcher, carrying
// `options.Loader`/`*PackageJSON` per watch item and doing a one-shot WorkPool
// directory crawl for recursive. The rewrite owns inotify/FSEvents/kqueue directly
// and dedupes by (realpath, recursive). These tests pin behaviour the old design
// couldn't provide.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// #15939 / #15085 / #24875: the old recursive implementation crawled the directory
// tree once on a WorkPool task and registered a watch per existing entry. Directories
// created *after* fs.watch() was called were never added to the watch set, so their
// contents were invisible. The rewritten Linux backend adds a new inotify wd on
// IN_CREATE|IN_ISDIR and walks the new subtree; FSEvents/Windows are recursive natively.
//
// FreeBSD's kqueue has no dir-child events; this case is inherently out of reach there
// and the backend emits a bare event on the parent instead (libuv behaviour).
describe.skipIf(isFreeBSD)("fs.watch recursive tracks post-watch structure", () => {
  test("sees files inside a directory created after watch()", async () => {
    using dir = tempDir("fs-watch-recursive-new-subdir", { "seed.txt": "x" });
    const root = String(dir);

    const seen: string[] = [];
    const watcher = fs.watch(root, { recursive: true }, (_ev, filename) => {
      if (typeof filename === "string") seen.push(filename.replaceAll("\\", "/"));
    });

    try {
      // Give the backend a beat to register the root (FSEvents has ~50ms latency,
      // inotify is synchronous).
      await Bun.sleep(100);

      const sub = path.join(root, "made-after");
      fs.mkdirSync(sub);

      // The crux: write into the directory that didn't exist when watch() ran.
      // Retry the write until the watcher has picked up the new subdir — avoids a
      // fixed sleep that would race with inotify IN_CREATE delivery.
      const target = path.join(sub, "inside.txt");
      let ok = false;
      for (let i = 0; i < 80 && !ok; i++) {
        fs.writeFileSync(target, String(i));
        await Bun.sleep(50);
        ok = seen.some(p => p === "made-after/inside.txt" || p.endsWith("inside.txt"));
      }

      // Old backend: `seen` would contain "made-after" (the mkdir on root) but never
      // "made-after/inside.txt" — the subdir was never registered. New backend adds
      // a wd for it on IN_CREATE|IN_ISDIR and the inner write shows up.
      expect(seen.some(p => p.includes("inside.txt"))).toBe(true);
    } finally {
      watcher.close();
    }
  });
});

// inotify watches by inode, so renaming a subdirectory inside a recursive watch keeps
// the same wd. On IN_MOVED_TO the dispatch loop re-adds the moved dir, inotify returns
// the *same* wd, and the backend must replace the owner's cached subpath — otherwise
// writes under the new name would be reported under the old name. (macOS/Windows are
// path-based natively; FreeBSD has no dir-child events so is skipped as above.)
test.skipIf(isFreeBSD)("recursive watch reports new path after subdirectory rename", async () => {
  using dir = tempDir("fs-watch-recursive-rename", { "a/seed.txt": "x" });
  const root = String(dir);

  const seen: string[] = [];
  const watcher = fs.watch(root, { recursive: true }, (_ev, filename) => {
    if (typeof filename === "string") seen.push(filename.replaceAll("\\", "/"));
  });

  try {
    // Poke until the backend has picked up the subdir (sync on Linux, ~50ms on FSEvents).
    for (let i = 0; i < 80 && !seen.some(p => p.startsWith("a/")); i++) {
      fs.writeFileSync(path.join(root, "a", "seed.txt"), String(i));
      await Bun.sleep(50);
    }

    fs.renameSync(path.join(root, "a"), path.join(root, "b"));
    seen.length = 0;

    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) {
      fs.writeFileSync(path.join(root, "b", "inside.txt"), String(i));
      await Bun.sleep(50);
      ok = seen.some(p => p === "b/inside.txt");
    }

    // Must surface as "b/inside.txt"; a stale subpath would have emitted "a/inside.txt".
    expect(seen).toContain("b/inside.txt");
    expect(seen.some(p => p.startsWith("a/"))).toBe(false);
  } finally {
    watcher.close();
  }
});

// Dedup: two fs.watch() calls on the same path share one OS watch. Both must receive
// events, and closing one must not silence the other. Previously each call routed to
// a shared bun.Watcher but through separate PathWatcher shims with their own
// file-path refcounting; the new design puts both handlers on one PathWatcher.
test("two watchers on the same path both receive events; closing one keeps the other alive", async () => {
  using dir = tempDir("fs-watch-dedup", { "a.txt": "1" });
  const root = String(dir);
  const file = path.join(root, "a.txt");

  const got = { a: 0, b: 0 };
  const wa = fs.watch(root, () => void got.a++);
  const wb = fs.watch(root, () => void got.b++);

  try {
    await Bun.sleep(100);
    for (let i = 0; i < 60 && (got.a === 0 || got.b === 0); i++) {
      fs.writeFileSync(file, String(i));
      await Bun.sleep(50);
    }
    expect(got.a).toBeGreaterThan(0);
    expect(got.b).toBeGreaterThan(0);

    // Drop one handler. The surviving watcher must keep firing — detaching one ctx
    // must not rm_watch the shared wd.
    wa.close();
    const bBefore = got.b;
    for (let i = 0; i < 60 && got.b === bBefore; i++) {
      fs.writeFileSync(file, "after-" + i);
      await Bun.sleep(50);
    }
    expect(got.b).toBeGreaterThan(bBefore);
  } finally {
    wa.close();
    wb.close();
  }
});

// Linux shares one inotify fd, and inotify_add_watch returns the same wd for the
// same inode. A recursive watch on /a and a plain watch on /a/sub therefore share
// the wd for /a/sub. Closing the inner watch must not rm_watch that wd out from
// under the recursive parent. (macOS/Windows don't have this aliasing but the test
// is still a valid behavioural check there.)
test.skipIf(isFreeBSD)("closing an inner watch does not break an overlapping recursive parent", async () => {
  using dir = tempDir("fs-watch-overlap", {
    "sub/seed.txt": "x",
  });
  const root = String(dir);
  const sub = path.join(root, "sub");
  const target = path.join(sub, "seed.txt");

  let parentHits = 0;
  const parent = fs.watch(root, { recursive: true }, () => void parentHits++);
  const inner = fs.watch(sub, () => {});
  try {
    await Bun.sleep(100);
    // Close the inner watch. On Linux this must drop *its* ownership of the shared
    // wd without issuing inotify_rm_watch (parent still owns it).
    inner.close();

    for (let i = 0; i < 60 && parentHits === 0; i++) {
      fs.writeFileSync(target, String(i));
      await Bun.sleep(50);
    }
    expect(parentHits).toBeGreaterThan(0);
  } finally {
    inner.close();
    parent.close();
  }
});

// The old PathWatcherManager was created with `vm.transpiler.fs` and wired into
// bun.Watcher's `top_level_dir`. The new backend has no such dependency — fs.watch()
// must work even on a completely cold VM that never touched the transpiler. Run a
// child process that does nothing but fs.watch to prove there's no hidden ordering
// dependency on the module-graph watcher.
test.skipIf(isWindows)("fs.watch works without any module-graph watcher state", async () => {
  using dir = tempDir("fs-watch-cold-vm", {
    "watched.txt": "init",
    "main.js": `
      const fs = require("fs");
      const path = require("path");
      const file = path.join(__dirname, "watched.txt");
      let done = false;
      const w = fs.watch(file, () => {
        if (done) return;
        done = true;
        console.log("HIT");
        w.close();
      });
      // Poke the file until the watcher fires. Bounded retry loop; bails out as
      // soon as the callback flips 'done'. 25ms between attempts so macOS (where
      // file watches now go through FSEvents — async-scheduled stream + ~50ms
      // coalescing latency) can't exhaust the budget before the first callback.
      let i = 0;
      const tick = () => {
        if (done) return;
        if (i++ > 200) { console.log("MISS"); process.exit(1); }
        fs.writeFileSync(file, String(i));
        setTimeout(tick, 25);
      };
      setTimeout(tick, 25);
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
  expect(stdout).toContain("HIT");
  expect(exitCode).toBe(0);
});
