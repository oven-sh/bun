import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// On Windows, `bun_sys::openat` routes through NtCreateFile via
// `openat_windows_impl`, which used to derive the create disposition from the
// access mode (O_WRONLY) instead of from O_TRUNC. That made `O_WRONLY|O_CREAT`
// truncate existing files and `O_RDWR|O_CREAT|O_TRUNC` leave them intact.
//
// `Bun.file(path).writer()` opens via this path with `O_WRONLY|O_CREAT` (no
// O_TRUNC), so on POSIX a short write over a longer existing file leaves the
// tail in place. Windows must match.
//
// The O_RDWR|O_TRUNC and remaining flag-combination cases are covered by the
// Rust unit tests in `bun_sys::openat_windows_disposition_tests`.
test("openat(O_WRONLY|O_CREAT) without O_TRUNC does not truncate", async () => {
  using dir = tempDir("openat-windows-trunc", {
    "seed.txt": Buffer.alloc(20, "A").toString(),
    "child.mjs": `
      import fs from "node:fs";
      const w = Bun.file("seed.txt").writer();
      w.write("short");
      await w.end();
      const out = fs.readFileSync("seed.txt", "utf8");
      console.log(JSON.stringify({ out, len: out.length }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "child.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout)).toEqual({ out: "short" + Buffer.alloc(15, "A").toString(), len: 20 });
  expect(exitCode).toBe(0);
});
