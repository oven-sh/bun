import { expect, test } from "bun:test";

import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("done() causes the test to fail when it should", async () => {
  await using dir = tempDir("done", {
    "done.test.ts": await Bun.file(path.join(import.meta.dir, "done-infinity.fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "done",
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
  expect(result.stderr.toString()).toContain(" 7 fail\n");
  expect(result.stderr.toString()).toContain(" 0 pass\n");
});

test("done(value) fails the test only when the value is truthy", async () => {
  using dir = tempDir("done-falsy", {
    "done-falsy.test.ts": await Bun.file(path.join(import.meta.dir, "done-falsy.fixture.ts")).text(),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--todo"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.split(/\r?\n/);

  // Every test name in the fixture starts with the verdict that the test must get.
  const wrong = lines.filter(line => {
    const verdict = /^\((pass|fail)\) /.exec(line)?.[1];
    return verdict !== undefined && !line.includes(verdict === "pass" ? " passes: " : " fails: ");
  });
  // An error that no test owns, such as one from a hook, adds an "errors" line.
  const summary = lines.filter(line => /^ \d+ (pass|fail|skip|todo|errors?)$/.test(line));

  expect({ wrong, summary, exitCode }).toEqual({
    wrong: [],
    summary: [" 33 pass", " 29 fail"],
    exitCode: 1,
  });
});
