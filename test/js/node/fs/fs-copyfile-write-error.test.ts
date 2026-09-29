// A copyFile/cp whose data copy fails (ENOSPC, EDQUOT, EIO, EFBIG) must not
// leave a destination behind. Node (libuv uv_fs_copyfile) removes it.
//
// RLIMIT_FSIZE (`ulimit -f`) makes the kernel fail the copy with EFBIG. Bun
// ignores SIGXFSZ, so the syscall fails instead of killing the process.
// - `ulimit -f 100` is 50 KB (dash, busybox: 512-byte blocks) or 100 KB (bash),
//   so part of the 120 KB source lands before the failure.
// - `ulimit -f 0` lets no byte land, like a filesystem with no free block.
// The source stays under 128 KB so that macOS takes the read/write path, not clonefile().
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

// Copies `src` to `<api>.bin` once for each API and reports each outcome.
const fixture = /* js */ `
const fs = require("node:fs");
const [src, ...apis] = process.argv.slice(2);
const out = {};
for (const api of apis) {
  const dest = api + ".bin";
  let code;
  try {
    if (api === "copyFileSync") fs.copyFileSync(src, dest);
    else if (api === "promises.copyFile") await fs.promises.copyFile(src, dest);
    else if (api === "copyFile") await new Promise((resolve, reject) => fs.copyFile(src, dest, e => (e ? reject(e) : resolve())));
    else if (api === "cpSync") fs.cpSync(src, dest);
    else if (api === "promises.cp") await fs.promises.cp(src, dest);
    else throw new Error("unknown api " + api);
    code = "ok";
  } catch (e) {
    code = e.code;
  }
  out[api] = { code, destExists: fs.existsSync(dest) };
}
console.log(JSON.stringify(out));
`;

describe.skipIf(isWindows)("copy that fails partway removes the destination", () => {
  // On Linux the default path is copy_file_range(); with it disabled the copy
  // goes through sendfile() and then the read/write loop, which is the path a
  // cross-filesystem copy takes.
  const variants = isLinux ? (["copy_file_range", "sendfile"] as const) : (["default"] as const);
  const cases = [
    ...["copyFileSync", "promises.copyFile", "copyFile", "cpSync", "promises.cp"].map(api => ({
      limit: 100,
      apis: [api],
    })),
    // One API for each native primitive: copyFile's and cp's.
    ...(isLinux ? [{ limit: 0, apis: ["copyFileSync", "cpSync"] }] : []),
  ];

  for (const variant of variants) {
    describe.concurrent(variant, () => {
      for (const { limit, apis } of cases) {
        it(`ulimit -f ${limit}: ${apis.join(", ")}`, async () => {
          using dir = tempDir("copyfile-write-error", { "copy.mjs": fixture });
          writeFileSync(join(String(dir), "src.bin"), Buffer.alloc(120 * 1024, "S"));
          // A pre-existing, larger destination: the failed copy must not leave
          // its stale bytes (or a hole) behind the bytes that did land.
          for (const api of apis) writeFileSync(join(String(dir), api + ".bin"), Buffer.alloc(200 * 1024, "D"));

          await using proc = Bun.spawn({
            cmd: ["/bin/sh", "-c", `ulimit -f ${limit}; exec "$0" "$@"`, bunExe(), "copy.mjs", "src.bin", ...apis],
            cwd: String(dir),
            env: {
              ...bunEnv,
              // A reflink (btrfs, XFS) writes nothing, so RLIMIT_FSIZE would not stop it.
              BUN_CONFIG_DISABLE_ioctl_ficlonerange: "1",
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: variant === "sendfile" ? "1" : undefined,
            },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(JSON.parse(stdout)).toEqual(
            Object.fromEntries(apis.map(api => [api, { code: "EFBIG", destExists: false }])),
          );
          expect(exitCode).toBe(0);
        });
      }
    });
  }

  // The error path must not unlink a destination that is the source itself.
  // COPYFILE_FICLONE_FORCE fails on filesystems without reflink support, and
  // that failure used to delete the only copy of the file.
  it("a failed COPYFILE_FICLONE_FORCE onto the same file keeps the file", () => {
    using dir = tempDir("copyfile-ficlone-same", { "a.txt": "hello world" });
    const file = join(String(dir), "a.txt");
    try {
      copyFileSync(file, file, constants.COPYFILE_FICLONE_FORCE);
    } catch {}
    expect(existsSync(file) && readFileSync(file, "utf8")).toBe("hello world");
  });

  // Only a regular file is removed. Node also removes a fifo and a device node.
  it("keeps a destination that is a fifo", async () => {
    using dir = tempDir("copyfile-fifo", {
      "copy.mjs": /* js */ `
        const fs = require("node:fs");
        let code;
        try { fs.copyFileSync("src.bin", "fifo"); code = "ok"; } catch (e) { code = e.code; }
        let dest;
        try { dest = fs.lstatSync("fifo").isFIFO() ? "fifo" : "not a fifo"; } catch { dest = "removed"; }
        console.log(JSON.stringify({ code, dest }));
      `,
    });
    const fifo = join(String(dir), "fifo");
    // A pipe holds less than this, so the copy cannot finish while nothing reads.
    writeFileSync(join(String(dir), "src.bin"), Buffer.alloc(120 * 1024, "S"));
    mkfifo(fifo, 0o666);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "copy.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // This open returns when the child has the fifo open for writing. With the
    // reader gone, the child's write fails with EPIPE.
    const reader = await open(fifo, "r");
    await reader.close();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: "EPIPE", dest: "fifo" });
    expect(exitCode).toBe(0);
  });
});
