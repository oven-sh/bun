import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunExe, isWindows } from "harness";
import path from "path";

const binaryName = isWindows ? "testFFI.exe" : "testFFI";

function findTestFFI(): string | null {
  const candidates = [
    process.env.BUN_TESTFFI_PATH,
    path.join(path.dirname(bunExe()), binaryName),
    path.join(import.meta.dir, "../../../../build/debug", binaryName),
    path.join(import.meta.dir, "../../../../build/release", binaryName),
  ].filter(Boolean) as string[];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

const testFFI = findTestFFI();

test.skipIf(!testFFI)(
  "testFFI (JavaScriptCore FFI C++/ABI checks)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [testFFI!],
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;
    if (exitCode !== 0 || !/OK: \d+ checks passed, 0 failed\./.test(output)) {
      console.log(output);
    }
    expect(exitCode).toBe(0);
    expect(output).toMatch(/OK: \d+ checks passed, 0 failed\./);
  },
  300_000,
);
