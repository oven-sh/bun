import { describe, expect, test } from "bun:test";

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

// A test that takes `done` and returns a promise completes when both settle.
// An already-fulfilled promise must not end the test before done() is called.
describe.each(["serial", "--concurrent"])("a returned fulfilled promise still waits for done() (%s)", mode => {
  test("done() is awaited and done(err) fails its own test", async () => {
    using dir = tempDir("done-and-promise", {
      "done.test.ts": `
        import { test, expect } from "bun:test";
        test("never calls done", done => {
          return Promise.resolve(1);
        }, 50);
        test("late done(err)", done => {
          return Promise.resolve().then(() => {
            setTimeout(() => {
              try { expect(1).toBe(2); done(); } catch (e) { done(e); }
            }, 10);
          });
        });
        test("late done()", done => {
          return Promise.resolve().then(() => {
            setTimeout(() => done(), 10);
          });
        });
        test("innocent", async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...(mode === "serial" ? [] : [mode]), "done.test.ts"],
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const lines = stderr.split("\n").filter(line => /^\((pass|fail)\)/.test(line));
    // Under --concurrent a late done(err) is still reported between tests, not
    // against its own test. That attribution is a separate fix.
    const results = lines.map(line => line.replace(/ \[[\d.]+m?s\]$/, "")).sort();
    expect(mode === "serial" ? results : results.filter(line => !line.endsWith("late done(err)"))).toEqual(
      mode === "serial"
        ? ["(fail) late done(err)", "(fail) never calls done", "(pass) innocent", "(pass) late done()"]
        : ["(fail) never calls done", "(pass) innocent", "(pass) late done()"],
    );
    expect(stderr).toContain("timed out after 50ms, before its done callback was called");
    expect(stderr).toContain("Expected: 2");
    expect(exitCode).toBe(1);
  });
});
