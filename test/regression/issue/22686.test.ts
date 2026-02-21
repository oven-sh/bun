import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/22686
// When a directory has files that differ only in case and extension
// (e.g. todos.ts and Todos.tsx), extensionless imports should resolve
// to the correct file based on case-sensitive stem matching.
test("extensionless import resolves correct file when similar names differ by case", async () => {
  using dir = tempDir("issue-22686", {
    "src/todos.ts": `export const todos = ["todo1", "todo2"];`,
    "src/Todos.tsx": `export function Todos() { return "Todos Component"; }`,
    "src/index.tsx": `
import { todos } from "./todos";
import { Todos } from "./Todos";
console.log(JSON.stringify(todos));
console.log(Todos());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "src/index.tsx"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('["todo1","todo2"]\nTodos Component\n');
  expect(exitCode).toBe(0);
});

test("bundler resolves correct file when similar names differ by case", async () => {
  using dir = tempDir("issue-22686-bundler", {
    "src/todos.ts": `export const todos = ["todo1", "todo2"];`,
    "src/Todos.tsx": `export function Todos() { return "Todos Component"; }`,
    "src/index.tsx": `
import { todos } from "./todos";
import { Todos } from "./Todos";
console.log(JSON.stringify(todos));
console.log(Todos());
`,
  });

  // First, bundle
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.tsx", "--outdir=dist"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStderr).toBe("");
  expect(buildExitCode).toBe(0);

  // Then run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "dist/index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runStderr).toBe("");
  expect(runStdout).toBe('["todo1","todo2"]\nTodos Component\n');
  expect(runExitCode).toBe(0);
});
