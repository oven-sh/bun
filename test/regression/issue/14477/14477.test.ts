import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("JSXElement with mismatched closing tags produces a syntax error", async () => {
  const files = await fs.promises.readdir(import.meta.dir);
  const fixtures = files.filter(file => !file.endsWith(".test.ts")).map(fixture => join(import.meta.dir, fixture));

  const bakery = fixtures.map(
    fixture =>
      Bun.spawn({
        cmd: [bunExe(), fixture],
        cwd: import.meta.dir,
        stdio: ["inherit", "inherit", "inherit"],
        env: bunEnv,
      }).exited,
  );

  // all subprocesses should fail.
  const exited = await Promise.all(bakery);
  expect(exited).toEqual(Array.from({ length: fixtures.length }, () => 1));
});

test.each([
  { src: "console.log(<Foo></Bar>);", tag: "<Foo>" },
  { src: "console.log(<div></p>);", tag: "<div>" },
  { src: "console.log(<>x</b>);", tag: "<>" },
])("JSX closing-tag mismatch error quotes $tag without escape characters", async ({ src, tag }) => {
  const expected = `Expected closing JSX tag to match opening tag "${tag}"`;

  // Bun.Transpiler: the error.message string a library reads.
  let message = "";
  try {
    new Bun.Transpiler({ loader: "tsx" }).transformSync(src);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toContain(expected);
  expect(message).not.toContain("\\");

  // bun build: the CLI-rendered error.
  using dir = tempDir("jsx-mismatch", { "in.tsx": src });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./in.tsx"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(expected);
  expect(stderr).not.toContain("\\<");
  expect(stderr).not.toContain("\\>");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
