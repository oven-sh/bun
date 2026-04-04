import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Requiring a package name with invalid characters (>, <, spaces, etc.)
// should not trigger auto-install. Before the fix, ESModule.Package.parse
// accepted these names, causing the resolver to attempt npm registry
// lookups for nonsensical package names.
test("require with invalid package name containing special chars", async () => {
  using dir = tempDir("resolve-invalid-pkg", {
    "package.json": "{}",
    // 33 bytes, contains <, >, ", space — all invalid in npm package names
    "run.js": [
      "const t = Bun.nanoseconds();",
      "try { require('<a name=\"undefined\">38391</a>'); } catch {}",
      "const ms = (Bun.nanoseconds() - t) / 1e6;",
      "// Without the fix: auto-install is attempted (100-300ms network roundtrip)",
      "// With the fix: ESModule.Package.parse rejects the name (<50ms)",
      "process.exit(ms > 50 ? 99 : 0);",
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=fallback", "run.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // 99 = auto-install was attempted (unfixed), 0 = skipped (fixed)
  expect(exitCode).toBe(0);
});
