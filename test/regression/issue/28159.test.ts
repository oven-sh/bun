import { expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("runtime transpiler cache is disabled when BUN_INSPECT is set", async () => {
  // When the debugger is active (via BUN_INSPECT env var), the runtime
  // transpiler cache must be disabled. The cached output does not contain the
  // inline //# sourceMappingURL= comment that the debugger frontend needs to
  // correctly map breakpoint line numbers. Without it, debugger; statements
  // and breakpoints resolve to the transpiled line instead of the source line.
  //
  // See: https://github.com/oven-sh/bun/issues/28159

  // Generate a large TypeScript file (>50KB) to trigger caching.
  const lines: string[] = [];
  lines.push("export function run() {");
  for (let i = 0; i < 700; i++) {
    lines.push(`  const value_${i}: number = ${i};`);
    lines.push(`  if (value_${i} !== ${i}) throw new Error("fail");`);
    lines.push("");
  }
  lines.push('  console.log("ok");');
  lines.push("}");
  lines.push("run();");

  const largeSource = lines.join("\n");
  expect(largeSource.length).toBeGreaterThan(50 * 1024);

  using dir = tempDir("issue-28159", {
    "large_module.ts": largeSource,
  });

  const cacheDir = join(String(dir), "cache");
  mkdirSync(cacheDir, { recursive: true });

  // Run with BUN_INSPECT set — the cache should NOT be populated.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "large_module.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
      BUN_INSPECT:
        process.platform === "win32" ? "127.0.0.1:0" : "ws+unix:///tmp/bun-inspect-fake-" + Date.now() + ".sock",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);

  // The cache directory should be empty because the cache was disabled.
  const cacheFiles = readdirSync(cacheDir);
  expect(cacheFiles).toEqual([]);
});
