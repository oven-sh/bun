import { expect, test } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("expect.assertions causes the test to fail when it should", async () => {
  await using dir = tempDir("expect-assertions", {
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
  $$.cwd(String(dir));
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("5 fail\n");
  expect(result.stderr.toString()).toContain("0 pass\n");
});

test("expect() calls made by a test after it timed out do not count towards the next test", async () => {
  // "timed out" only continues once "counts its own" has started, so it has always timed out by
  // then; the two expect() calls it makes from there on belong to it, not to the running test.
  using dir = tempDir("late-expect-calls", {
    "late.test.ts": /* ts */ `
      import { expect, test } from "bun:test";
      const nextStarted = Promise.withResolvers<void>();
      const lateCallsDone = Promise.withResolvers<void>();
      test("timed out", async () => {
        await nextStarted.promise;
        expect(1).toBe(1);
        expect(2).toBe(2);
        lateCallsDone.resolve();
      }, 1);
      test("counts its own", async () => {
        expect.assertions(1);
        nextStarted.resolve();
        await lateCallsDone.promise;
        expect(3).toBe(3);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "late.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("(fail) timed out");
  expect(stderr).toContain("(pass) counts its own");
  expect(stderr).not.toContain("expected 1 assertion");
  // The late calls are still counted in the total, just not against the running test.
  expect(stderr).toContain(" 3 expect() calls\n");
  expect(exitCode).toBe(1);
});
