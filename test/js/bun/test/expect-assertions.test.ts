import { expect, test } from "bun:test";

import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import path from "path";

test("expect.assertions causes the test to fail when it should", async () => {
  const dir = tempDirWithFiles("expect-assertions", {
    "expect-assertions.test.ts": await Bun.file(path.join(import.meta.dir, "expect-assertions-fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "expect-assertions",
      version: "0.0.0",
      scripts: {
        test: "bun test",
      },
    }),
  });

  const $$ = new Bun.$.Shell();
  $$.nothrow();
  $$.cwd(dir);
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("5 fail\n");
  expect(result.stderr.toString()).toContain("0 pass\n");
});

test("expect.assertions: matcher argument-validation errors do not count as assertions", async () => {
  const dir = tempDirWithFiles("expect-assertions-invalid-args", {
    "invalid-args.test.ts": await Bun.file(
      path.join(import.meta.dir, "expect-assertions-invalid-args-fixture.ts"),
    ).text(),
    "package.json": JSON.stringify({ name: "expect-assertions-invalid-args", version: "0.0.0" }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "invalid-args.test.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const failing = [...stderr.matchAll(/\(fail\) (.+?)(?: \[|$)/gm)].map(m => m[1]);
  expect(failing).toEqual([]);
  expect(normalizeBunSnapshot(stderr, dir)).toContain(" 0 fail\n");
  expect(stderr).toContain(" 31 pass\n");
  expect(stderr).toContain(" 14 expect() calls\n");
  expect(exitCode).toBe(0);
});
