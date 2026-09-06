import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunExe, isCI, isWindows } from "harness";
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

// Every CI build ships testFFI next to bun (scripts/build/bun.ts builds it,
// ci.ts packages it), so a missing binary there is a packaging regression,
// not a reason to skip. Locally it is absent only for a --webkit=prebuilt
// build that has not fetched the tarball's copy.
if (isCI) {
  test("testFFI binary is packaged next to bun", () => {
    expect(testFFI, `no ${binaryName} next to ${bunExe()} (or at $BUN_TESTFFI_PATH)`).not.toBeNull();
  });
}

test.skipIf(!testFFI && !isCI)(
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
