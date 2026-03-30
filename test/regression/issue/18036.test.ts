import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import path from "node:path";

// Bun crashed on Linux kernels < 4.11 (e.g. Synology NAS kernel 4.4) because
// the vendored Zig stdlib's File.stat() used the statx syscall without an
// ENOSYS fallback. This test uses seccomp BPF to block statx (simulating an
// old kernel) and verifies bun still works.
describe.skipIf(process.platform !== "linux")("statx ENOSYS fallback for old kernels", () => {
  const blockStatxSrc = path.join(import.meta.dir, "18036", "block_statx.c");
  const blockStatxBin = path.join(import.meta.dir, "18036", "block_statx");

  test("compile block_statx helper", () => {
    const result = Bun.spawnSync({
      cmd: ["cc", "-o", blockStatxBin, blockStatxSrc],
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(blockStatxBin)).toBe(true);
  });

  test("transpile and run TypeScript with statx blocked", async () => {
    using dir = tempDir("issue-18036", {
      "index.ts": `import { foo } from "./foo";\nconsole.log(foo());`,
      "foo.ts": `export function foo(): number { return 42; }`,
    });

    await using proc = Bun.spawn({
      cmd: [blockStatxBin, bunExe(), "run", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("42\n");
    expect(exitCode).toBe(0);
  });

  test("bun build --outdir with statx blocked", async () => {
    using dir = tempDir("issue-18036-build", {
      "main.ts": `export async function main() { return 1; }`,
    });

    await using proc = Bun.spawn({
      cmd: [blockStatxBin, bunExe(), "build", "main.ts", "--outdir", "out"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error");
    expect(stderr).not.toContain("Unexpected");
    expect(exitCode).toBe(0);
  });

  test("fs.statSync works with statx blocked", async () => {
    await using proc = Bun.spawn({
      cmd: [
        blockStatxBin,
        bunExe(),
        "-e",
        `const fs = require("fs");
         const stat = fs.statSync(process.execPath);
         console.log(typeof stat.size);
         console.log(stat.size > 0);
         console.log(typeof stat.mtimeMs);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("number\ntrue\nnumber\n");
    expect(exitCode).toBe(0);
  });
});
