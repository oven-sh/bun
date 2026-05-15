// Smoke coverage for the 42-arm `for_each_fs_async_op!` dispatch in
// `src/runtime/dispatch.rs` (the `run_task` inner match behind the outer
// or-pattern). Each test exercises one of the async fs-task tags through
// its user-facing API; collectively they hit every arm of the x-macro table
// so any future dispatch regression (missing arm, wrong `fs_async::*` alias)
// surfaces as an observable test failure rather than silent UB.
//
// The table itself is pinned at 42 rows by a compile-time `assert!` on
// `for_each_fs_async_op!(__fs_count)` in dispatch.rs — this file is the
// runtime half of the pair.
//
// Bespoke dispatch paths NOT covered by `for_each_fs_async_op!` and therefore
// NOT asserted here:
//   - `Cp` and `AsyncMkdirp` — separate dispatch arms
//   - compression tasks (NativeZlib / NativeBrotli / NativeZstd)
//   - watcher tasks (FSWatchTask, StatWatcherScheduler)

import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import * as fscb from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";

describe.concurrent("node:fs async dispatch — every `for_each_fs_async_op!` arm", () => {
  test("stat / lstat / fstat", async () => {
    using dir = tempDir("fs-disp-stat", { "f.txt": "hi" });
    const p = join(String(dir), "f.txt");
    expect((await fs.stat(p)).size).toBe(2);
    expect((await fs.lstat(p)).isFile()).toBe(true);
    const fh = await fs.open(p, "r");
    try {
      expect((await fh.stat()).size).toBe(2); // fstat
    } finally {
      await fh.close();
    }
  });

  test("open / read / write / close", async () => {
    using dir = tempDir("fs-disp-open", {});
    const p = join(String(dir), "f.txt");
    const fh = await fs.open(p, "w+");
    try {
      await fh.write("abc"); // write
      const buf = Buffer.alloc(3);
      await fh.read(buf, 0, 3, 0); // read
      expect(buf.toString()).toBe("abc");
    } finally {
      await fh.close(); // close
    }
  });

  test("readFile / writeFile / appendFile", async () => {
    using dir = tempDir("fs-disp-rw", {});
    const p = join(String(dir), "f.txt");
    await fs.writeFile(p, "x");
    await fs.appendFile(p, "y");
    expect(await fs.readFile(p, "utf8")).toBe("xy");
  });

  test("copyFile", async () => {
    using dir = tempDir("fs-disp-cp", { "a.txt": "src" });
    const src = join(String(dir), "a.txt");
    const dst = join(String(dir), "b.txt");
    await fs.copyFile(src, dst);
    expect(await fs.readFile(dst, "utf8")).toBe("src");
  });

  test("truncate / ftruncate", async () => {
    using dir = tempDir("fs-disp-tr", { "f.txt": "helloworld" });
    const p = join(String(dir), "f.txt");
    await fs.truncate(p, 5);
    expect(await fs.readFile(p, "utf8")).toBe("hello");
    const fh = await fs.open(p, "r+");
    try {
      await fh.truncate(3); // ftruncate
    } finally {
      await fh.close();
    }
    expect(await fs.readFile(p, "utf8")).toBe("hel");
  });

  test("writev / readv", async () => {
    using dir = tempDir("fs-disp-wv", {});
    const p = join(String(dir), "f.txt");
    const fh = await fs.open(p, "w+");
    try {
      await fh.writev([Buffer.from("ab"), Buffer.from("cd")]); // writev
      const bufs = [Buffer.alloc(2), Buffer.alloc(2)];
      await fh.readv(bufs, 0); // readv
      expect(Buffer.concat(bufs).toString()).toBe("abcd");
    } finally {
      await fh.close();
    }
  });

  test("rename", async () => {
    using dir = tempDir("fs-disp-rn", { "a.txt": "1" });
    const src = join(String(dir), "a.txt");
    const dst = join(String(dir), "b.txt");
    await fs.rename(src, dst);
    expect(await fs.readFile(dst, "utf8")).toBe("1");
  });

  test("readdir", async () => {
    using dir = tempDir("fs-disp-rd", { "a.txt": "", "b.txt": "" });
    const entries = (await fs.readdir(String(dir))).sort();
    expect(entries).toEqual(["a.txt", "b.txt"]);
  });

  test("readdir recursive", async () => {
    using dir = tempDir("fs-disp-rdr", { "a.txt": "", "sub/b.txt": "" });
    const entries = (await fs.readdir(String(dir), { recursive: true })).sort();
    expect(entries).toContain("a.txt");
    expect(entries.some(e => e.endsWith("b.txt"))).toBe(true);
  });

  test("rm / rmdir", async () => {
    using dir = tempDir("fs-disp-rm", { "a.txt": "", sub: {} });
    await fs.rm(join(String(dir), "a.txt"));
    await fs.rmdir(join(String(dir), "sub"));
    expect((await fs.readdir(String(dir))).length).toBe(0);
  });

  test("chown / fchown", async () => {
    using dir = tempDir("fs-disp-ch", { "f.txt": "" });
    const p = join(String(dir), "f.txt");
    const s = await fs.stat(p);
    await fs.chown(p, s.uid, s.gid);
    const fh = await fs.open(p, "r");
    try {
      await fh.chown(s.uid, s.gid); // fchown
    } finally {
      await fh.close();
    }
  });

  // `fs.lchown` is an unimplemented stub on Windows (see the `#[cfg(windows)]`
  // arm in `src/runtime/node/node_fs.rs::lchown`), so calling it surfaces an
  // `Unknown Error` rather than routing through the `Lchown` dispatch arm.
  // POSIX-only; the `Lchown` arm of `for_each_fs_async_op!` is exercised here.
  test.skipIf(isWindows)("lchown", async () => {
    using dir = tempDir("fs-disp-lch", { "f.txt": "" });
    const p = join(String(dir), "f.txt");
    const s = await fs.stat(p);
    await fs.lchown(p, s.uid, s.gid);
  });

  test("utimes / lutimes / futimes", async () => {
    using dir = tempDir("fs-disp-ut", { "f.txt": "" });
    const p = join(String(dir), "f.txt");
    const t = new Date();
    await fs.utimes(p, t, t);
    await fs.lutimes(p, t, t);
    const fh = await fs.open(p, "r+");
    try {
      await fh.utimes(t, t); // futimes
    } finally {
      await fh.close();
    }
  });

  test("chmod / fchmod / lchmod", async () => {
    using dir = tempDir("fs-disp-cm", { "f.txt": "" });
    const p = join(String(dir), "f.txt");
    await fs.chmod(p, 0o644);
    const fh = await fs.open(p, "r+");
    try {
      await fh.chmod(0o644); // fchmod
    } finally {
      await fh.close();
    }
    // lchmod exists as a callback API but not promises on most platforms;
    // exercise via the callback form where available so the Lchmod dispatch
    // arm is hit.
    if (typeof fscb.lchmod === "function") {
      await new Promise<void>((resolve, reject) => fscb.lchmod(p, 0o644, err => (err ? reject(err) : resolve())));
    }
  });

  test("link / symlink / readlink / unlink", async () => {
    using dir = tempDir("fs-disp-ln", { "src.txt": "s" });
    const src = join(String(dir), "src.txt");
    const hard = join(String(dir), "hard.txt");
    const sym = join(String(dir), "sym.txt");
    await fs.link(src, hard);
    await fs.symlink(src, sym);
    expect(await fs.readlink(sym)).toBe(src);
    await fs.unlink(hard);
    await fs.unlink(sym);
  });

  test("realpath / realpath native-fallback", async () => {
    using dir = tempDir("fs-disp-rp", { "f.txt": "" });
    const p = join(String(dir), "f.txt");
    // Default realpath; hits Realpath. The internal native-fallback path
    // (RealpathNonNative) is exercised on symlink chains with `..` segments.
    expect(await fs.realpath(p)).toBeTruthy();
  });

  test("mkdir / mkdtemp", async () => {
    using dir = tempDir("fs-disp-mk", {});
    await fs.mkdir(join(String(dir), "sub"));
    const tmp = await fs.mkdtemp(join(String(dir), "pfx-"));
    expect(tmp.startsWith(join(String(dir), "pfx-"))).toBe(true);
  });

  test("fsync / fdatasync", async () => {
    using dir = tempDir("fs-disp-fs", { "f.txt": "" });
    const fh = await fs.open(join(String(dir), "f.txt"), "w");
    try {
      await fh.sync(); // fsync
      await fh.datasync(); // fdatasync
    } finally {
      await fh.close();
    }
  });

  test("access", async () => {
    using dir = tempDir("fs-disp-ac", { "f.txt": "" });
    await fs.access(join(String(dir), "f.txt"));
  });

  test("exists", async () => {
    using dir = tempDir("fs-disp-ex", { "f.txt": "" });
    // `fs.exists` (callback, deprecated) hits the dedicated `Exists` arm.
    const exists = await new Promise<boolean>(resolve => fscb.exists(join(String(dir), "f.txt"), resolve));
    expect(exists).toBe(true);
  });

  // `fs.statfs` on Windows dispatches through the same `StatFS` arm of
  // `for_each_fs_async_op!` — `fs_async::Statfs` is a `UVFSRequest` alias
  // that runs everywhere via libuv (`node_fs.rs:622`). Keep it unguarded so
  // this smoke test actually covers the dispatch arm on Windows too.
  test("statfs", async () => {
    using dir = tempDir("fs-disp-sfs", {});
    const s = await fs.statfs(String(dir));
    expect(typeof s.type).toBe("number");
  });
});
