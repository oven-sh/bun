import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `require.main === module` is folded into one AST node. The printer must
// wrap what it prints for that node in parentheses when the parent binds
// tighter, the same as it does for the original binary expression.
const source = /* js */ `
  const out = [
    "main: " + (require.main === module),
    "not main: " + !(require.main === module),
    "neq: " + (require.main !== module),
    (require.main === module).toString(),
    (require.main !== module).toString(),
    typeof (require.main === module),
    typeof (require.main !== module),
    [require.main === module],
    (require.main !== module) ** 2,
  ];
  console.log(JSON.stringify(out));
`;

const expected = JSON.stringify([
  "main: true",
  "not main: false",
  "neq: false",
  "true",
  "false",
  "boolean",
  "boolean",
  [true],
  0,
]);

test.concurrent("require.main === module keeps its parentheses inside a larger expression", async () => {
  using dir = tempDir("issue-45776", { "entry.cjs": source });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(expected);
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  [
    "cjs",
    ["--no-bundle", "--format=cjs", "--target=bun"],
    ["(require.main == module)", "!(require.main == module)", "(require.main != module)"],
  ],
  [
    "node",
    ["--target=node"],
    [
      "(__require.main == __require.module)",
      "!(__require.main == __require.module)",
      "(__require.main != __require.module)",
    ],
  ],
  ["esm", ["--no-bundle", "--format=esm", "--target=bun"], ["(!import.meta.main).toString()", "(!import.meta.main) ** 2"]],
])("the printer wraps the lowered form for %s output", async (_name, flags, wrapped) => {
  using dir = tempDir("issue-45776-print", { "entry.cjs": source });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...flags, "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  for (const text of wrapped) {
    expect(stdout).toContain(text);
  }
  expect(exitCode).toBe(0);
});
