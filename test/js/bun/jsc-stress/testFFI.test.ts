import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { isWindows } from "harness";
import path from "path";

const binaryName = isWindows ? "testFFI.exe" : "testFFI";

function findTestFFI(): string | null {
  const explicit = process.env.BUN_TESTFFI_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const roots = [
    process.env.BUN_WEBKIT_PATH,
    path.join(import.meta.dir, "../../../../build/debug-local/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/release-local/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/debug/deps/WebKit"),
    path.join(import.meta.dir, "../../../../build/release/deps/WebKit"),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    for (const candidate of [
      path.join(root, "bin", binaryName),
      path.join(root, "WebKitBuild/Release/bin", binaryName),
      path.join(root, "WebKitBuild/Debug/bin", binaryName),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const testFFI = findTestFFI();

test.skipIf(!testFFI)("testFFI (JavaScriptCore FFI C++/ABI checks)", async () => {
  await using proc = Bun.spawn({
    cmd: [testFFI!],
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
}, 300_000);
