// A copyFile/cp whose data copy fails partway (ENOSPC, EDQUOT, EIO, EFBIG)
// must not leave a destination behind that has the source's size but not its
// bytes. Node (libuv uv_fs_copyfile) removes the destination on failure.
//
// `ulimit -f 100` gives the child an RLIMIT_FSIZE of 50 KB (dash, busybox:
// 512-byte blocks) or 100 KB (bash: 1024-byte blocks). Either is below the
// 120 KB source, so the kernel stops the copy with EFBIG partway. Bun ignores
// SIGXFSZ, so the syscall fails instead of killing the process. The source
// stays under 128 KB so that macOS takes the read/write path, not clonefile().
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fixture = /* js */ `
const fs = require("node:fs");
const [src, dest, api] = process.argv.slice(2);
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
console.log(JSON.stringify({ code, destExists: fs.existsSync(dest) }));
`;

describe.skipIf(isWindows)("copy that fails partway removes the destination", () => {
  const apis = ["copyFileSync", "promises.copyFile", "copyFile", "cpSync", "promises.cp"] as const;
  // On Linux the default path is copy_file_range(); with it disabled the copy
  // goes through sendfile() and then the read/write loop, which is the path a
  // cross-filesystem copy takes.
  const variants = isLinux ? (["copy_file_range", "sendfile"] as const) : (["default"] as const);

  for (const variant of variants) {
    describe.concurrent(variant, () => {
      for (const api of apis) {
        it(api, async () => {
          using dir = tempDir("copyfile-write-error", { "copy.mjs": fixture });
          const src = join(String(dir), "src.bin");
          const dest = join(String(dir), "dest.bin");
          writeFileSync(src, Buffer.alloc(120 * 1024, "S"));
          // A pre-existing, larger destination: the failed copy must not leave
          // its stale tail (or a hole) behind the bytes that did land.
          writeFileSync(dest, Buffer.alloc(200 * 1024, "D"));

          await using proc = Bun.spawn({
            cmd: ["/bin/sh", "-c", `ulimit -f 100; exec "$0" "$@"`, bunExe(), "copy.mjs", src, dest, api],
            cwd: String(dir),
            env: {
              ...bunEnv,
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: variant === "sendfile" ? "1" : undefined,
            },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(JSON.parse(stdout)).toEqual({ code: "EFBIG", destExists: false });
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
});
