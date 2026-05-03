import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(30_000);

test("import.meta.env is lowered to process.env in bun build", async () => {
  using dir = tempDir("issue-21097-bundle", {
    "index.ts": "console.log(import.meta.env.FOO)",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", join(String(dir), "index.ts")],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("process.env.FOO");
  expect(stdout).not.toContain("import.meta.env");
  expect(exitCode).toBe(0);
});

test("import.meta.env lowering does not shadow a local process binding", async () => {
  // When `process` is shadowed by a local parameter, the rewrite must not
  // silently reference the local. Leave import.meta.env as-is so Bun's
  // runtime resolves it to the real global.
  using dir = tempDir("issue-21097-shadow", {
    "index.ts": `
function handler(process: any) {
  return import.meta.env.FOO;
}
console.log(handler.toString());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", join(String(dir), "index.ts")],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The shadowed scope must NOT be rewritten to `process.env.FOO`,
  // which would reference the parameter instead of the global.
  expect(stdout).toContain("import.meta.env.FOO");
  expect(stdout).not.toContain("process.env.FOO");
  expect(exitCode).toBe(0);
});

test("import.meta.env works in bun build --compile --bytecode", async () => {
  using dir = tempDir("issue-21097-bc", {
    "index.ts": `
const val = import.meta.env.TEST_VAR_21097_BC;
if (val) {
  console.log("found:" + val);
} else {
  console.log("not-found");
}
`,
  });

  const outfile = join(String(dir), isWindows ? "test-binary-bc.exe" : "test-binary-bc");

  // Compile with bytecode - previously failed with "Failed to generate bytecode"
  await using compile = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--bytecode", join(String(dir), "index.ts"), "--outfile", outfile],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [compileStdout, compileStderr, compileExit] = await Promise.all([
    compile.stdout.text(),
    compile.stderr.text(),
    compile.exited,
  ]);

  expect(compileStderr).not.toContain("Failed to generate bytecode");
  expect(compileExit).toBe(0);

  // Run with env var - previously crashed with TypeError
  await using withEnv = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, TEST_VAR_21097_BC: "bytecode-works" },
    cwd: String(dir),
    stderr: "pipe",
  });

  const [withEnvStdout, withEnvStderr, withEnvExit] = await Promise.all([
    withEnv.stdout.text(),
    withEnv.stderr.text(),
    withEnv.exited,
  ]);

  expect(withEnvStderr).not.toContain("TypeError: Expected CommonJS module to have a function wrapper");
  expect(withEnvStdout).toBe("found:bytecode-works\n");
  expect(withEnvExit).toBe(0);
});
