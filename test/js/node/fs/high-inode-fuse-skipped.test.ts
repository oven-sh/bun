// Regression test for the bug where `fs.statSync(file).ino` collapsed every
// file on a filesystem with 64-bit inodes (e.g. NFS) to `INT64_MAX` because
// `Stat.zig` clamped the u64 `st_ino` before handing it to the C++ binding.
//
// Unlike the synthetic tests in `test/js/node/fs/fs-stats-truncate.test.ts`
// (which drive the `statToJS` conversion directly via an internal helper),
// this test actually mounts a FUSE passthrough filesystem that hands out
// inode numbers near 2^63 and then calls real `fs.statSync` / `fs.readdir`
// against the mount. It's the same shape as the original bug report.
//
// It's **skipped in CI** because:
//   1. Most CI containers don't expose `/dev/fuse` / don't have
//      `CAP_SYS_ADMIN`, so `fusermount` fails with EPERM before we get
//      anywhere.
//   2. The test depends on Python 3 with the `fusepy` module (or the
//      equivalent `python3-fuse` package) being installed on the host.
//
// To run it locally on Linux:
//
//   apt-get install python3-fuse fuse3   # Debian/Ubuntu
//   # or:  pip3 install fusepy
//   bun test test/js/node/fs/high-inode-fuse-skipped.test.ts
//
// The synthetic tests in `fs-stats-truncate.test.ts` still cover the
// conversion path in CI.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isCI, isLinux, tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Near 2^63 — the original NFS-like inode from the bug report.
const INODE_OFFSET = 9225185599684000000n;
const files = ["file1.md", "file2.md", "file3.md", "file4.md"];

function canRun(): string | null {
  if (!isLinux) return "FUSE is Linux-only";
  if (isCI) return "FUSE requires /dev/fuse and CAP_SYS_ADMIN, not available in CI";
  if (!existsSync("/dev/fuse")) return "/dev/fuse not available";

  // `/dev/fuse` can exist but still be unopenable without `CAP_SYS_ADMIN`
  // (rootless containers, etc). Probe by actually opening it.
  try {
    closeSync(openSync("/dev/fuse", "r"));
  } catch (e) {
    return `/dev/fuse cannot be opened: ${(e as Error).message}`;
  }

  // Need python3 with a FUSE binding.
  const probe = spawnSync("python3", ["-c", "import fuse; print(fuse.Fuse.__name__)"], { stdio: "pipe" });
  if (probe.status !== 0) return "python3 FUSE bindings (python3-fuse or fusepy) not installed";

  // Need an unprivileged fusermount.
  const fm = spawnSync("sh", ["-c", "command -v fusermount || command -v fusermount3"], { stdio: "pipe" });
  if (fm.status !== 0) return "fusermount binary not found";
  return null;
}

const skipReason = canRun();

describe.skipIf(skipReason != null)("high-inode FUSE regression", () => {
  // Allocated in beforeAll so nothing is created at collection time when the
  // whole suite is skipped. Kept in outer-scope `let`s so the tests + afterAll
  // cleanup can reach them.
  let dir: ReturnType<typeof tempDir> | undefined;
  let src: string;
  let mnt: string;
  let fuseScript: string;

  beforeAll(async () => {
    const seed: Record<string, string> = {};
    for (const f of files) seed[`src/${f}`] = `stub ${f}\n`;
    dir = tempDir("high-inode-fuse-", seed);
    const base = String(dir);
    src = join(base, "src");
    mnt = join(base, "mnt");
    fuseScript = join(base, "highino_fuse.py");
    mkdirSync(mnt, { recursive: true });

    // Minimal FUSE passthrough using python3-fuse. Reports every file's
    // inode as `INODE_OFFSET + file_index * STRIDE`, producing distinct
    // values all well above 2^63.
    //
    // STRIDE has to be >= the IEEE-754 ULP at `INODE_OFFSET`. For values
    // near 2^63 the ULP of a `double` is 2^11 = 2048, so two u64 inodes
    // differing by less than 2048 collapse to the same `Number`. Real
    // tmpfs/ext4 inodes are usually consecutive, so `OFFSET + real_ino`
    // would produce inodes within a single ULP bucket and the distinct-
    // -inode assertion further down would fail even after the fix. Use a
    // per-file stride of 4096 (2 × ULP) so the distinct inodes survive
    // the round-trip through `double`.
    //
    // The source directory and the file→inode map are baked in as Python
    // literals so there's no risk of `sys.argv` index confusion with
    // FUSE's own option parsing.
    const inoMap: Record<string, string> = {};
    files.forEach((f, i) => {
      inoMap[f] = (INODE_OFFSET + BigInt(i) * 4096n).toString();
    });
    writeFileSync(
      fuseScript,
      `
import os, sys, errno
import fuse
from fuse import Fuse, Stat, Direntry
fuse.fuse_python_api = (0, 2)

SRC = ${JSON.stringify(src)}
INOS = {${Object.entries(inoMap)
        .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
        .join(", ")}}

class HighIno(Fuse):
    def _full(self, p):
        return os.path.join(SRC, p.lstrip("/"))
    def getattr(self, path):
        try:
            st = os.lstat(self._full(path))
        except OSError as e:
            return -e.errno
        s = Stat()
        s.st_mode = st.st_mode
        name = os.path.basename(path.rstrip("/"))
        s.st_ino = INOS.get(name, st.st_ino)
        s.st_nlink = st.st_nlink
        s.st_uid = st.st_uid
        s.st_gid = st.st_gid
        s.st_size = st.st_size
        s.st_atime = int(st.st_atime)
        s.st_mtime = int(st.st_mtime)
        s.st_ctime = int(st.st_ctime)
        s.st_dev = 0
        s.st_rdev = 0
        s.st_blksize = 4096
        s.st_blocks = (st.st_size + 511) // 512
        return s
    def readdir(self, path, offset):
        for e in [".", ".."] + os.listdir(self._full(path)):
            yield Direntry(e)
    def open(self, path, flags):
        try:
            fd = os.open(self._full(path), flags); os.close(fd); return 0
        except OSError as e:
            return -e.errno
    def read(self, path, size, offset):
        with open(self._full(path), "rb") as f:
            f.seek(offset); return f.read(size)

server = HighIno(version="%prog 1.0", usage=Fuse.fusage, dash_s_do="setsingle")
server.parse(errex=1)
server.main()
`,
    );

    // Mount without \`allow_other\` — that requires \`user_allow_other\`
    // in /etc/fuse.conf which isn't set on default installs. \`use_ino\`
    // keeps our synthetic inode numbers; \`-s\` forces single-threaded
    // operation.
    const mount = spawnSync("python3", [fuseScript, mnt, "-o", "use_ino", "-s"], { stdio: "pipe" });
    if (mount.status !== 0) {
      throw new Error(
        `python3-fuse mount failed: status=${mount.status}\n` +
          `stdout: ${mount.stdout?.toString()}\nstderr: ${mount.stderr?.toString()}`,
      );
    }

    // Wait briefly for the mount to become visible. Fail loudly if it
    // never does — the individual test bodies would otherwise fail with
    // confusing ENOENT errors that don't mention the mount. `Bun.sleep`
    // between polls keeps the wait off the hot path while readdirSync
    // would otherwise fail-fast with ENOENT/ENOTCONN at tens of thousands
    // of iterations per second.
    const deadline = Date.now() + 3000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        if (readdirSync(mnt).length === files.length) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(25);
    }
    if (!ready) {
      // Capture the final state defensively — the most common reason we
      // get here is the mount never coming up, in which case `readdirSync`
      // itself throws and would otherwise clobber this error message.
      let seen: number | string;
      try {
        seen = readdirSync(mnt).length;
      } catch (e) {
        seen = `(read error: ${(e as Error).message})`;
      }
      throw new Error(
        `python3-fuse mount did not become ready within 3s at ${mnt}. ` +
          `Expected ${files.length} entries; saw ${seen}.`,
      );
    }
  });

  afterAll(() => {
    // Best-effort unmount + cleanup. We have to unmount the FUSE mount
    // first or the `mnt` dir will be busy when `dir`'s dispose tries to
    // `rm -rf` the temp root.
    if (mnt) {
      for (const bin of ["fusermount", "fusermount3"]) {
        const r = spawnSync(bin, ["-u", mnt], { stdio: "pipe" });
        if (r.status === 0) break;
      }
    }
    try {
      (dir as unknown as { [Symbol.dispose]?: () => void })?.[Symbol.dispose]?.();
    } catch {}
  });

  test("fs.readdirSync sees every file", () => {
    const entries = readdirSync(mnt).sort();
    expect(entries).toEqual([...files].sort());
  });

  test("fs.statSync returns distinct high inodes (matches Node)", () => {
    const bunInos: number[] = [];
    for (const f of files) {
      const s = statSync(join(mnt, f));
      bunInos.push(s.ino);
      // Every inode must be comfortably above INT64_MAX — that's the whole
      // point of the repro. Pre-fix, this came back as 9.223372036854776e18
      // (the INT64_MAX clamp).
      expect(Number.isFinite(s.ino)).toBe(true);
      expect(s.ino).toBeGreaterThan(9e18);
    }
    // And every file has a distinct inode. Pre-fix, every entry collapsed
    // to the same clamped value.
    expect(new Set(bunInos).size).toBe(files.length);

    // Cross-check with Node itself — Bun's output should match it
    // bit-for-bit (both go via u64 -> double).
    const nodeOut = spawnSync(
      "node",
      [
        "-e",
        `const fs=require('fs');process.stdout.write(JSON.stringify(${JSON.stringify(
          files,
        )}.map(f=>fs.statSync(require('path').join(${JSON.stringify(mnt)},f)).ino)));`,
      ],
      { stdio: "pipe" },
    );
    if (nodeOut.status === 0) {
      const nodeInos = JSON.parse(nodeOut.stdout.toString());
      expect(bunInos).toEqual(nodeInos);
    }
  });

  test("fs.statSync with { bigint: true } preserves the u64 inode", () => {
    // Node represents BigIntStats via BigInt64Array (signed int64), so
    // u64 values above INT64_MAX wrap to negative. We match Node exactly.
    for (const f of files) {
      const s = statSync(join(mnt, f), { bigint: true });
      expect(typeof s.ino).toBe("bigint");
      // Not the old clamp sentinel.
      expect(s.ino as bigint).not.toBe((1n << 63n) - 1n);
    }
    const set = new Set(files.map(f => (statSync(join(mnt, f), { bigint: true }).ino as bigint).toString()));
    expect(set.size).toBe(files.length);
  });
});
