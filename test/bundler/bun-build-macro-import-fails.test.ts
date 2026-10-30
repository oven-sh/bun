import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

test("Bun.build rejects when a macro throws while it is imported", async () => {
  using dir = tempDir("bun-build-macro-import-fails", {
    "entry.ts": `import { m } from "./macro.ts" with { type: "macro" };\nconsole.log(m());\n`,
    "macro.ts": `throw new Error("thrown while the macro is imported");\nexport function m() {\n  return 1;\n}\n`,
    "build.ts": `const result = await Bun.build({ entrypoints: ["./entry.ts"] }).catch(error => error);\nconsole.log(result instanceof AggregateError, result.message);\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    cwd: String(dir),
    // The VM of the bundler's thread is never destroyed, nor the source map that it parses to print the error.
    env: isASAN
      ? { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") }
      : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("thrown while the macro is imported");
  expect({ stdout, signal: proc.signalCode, exitCode }).toEqual({
    stdout: "true Bundle failed\n",
    signal: null,
    exitCode: 0,
  });
});
