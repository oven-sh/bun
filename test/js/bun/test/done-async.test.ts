import { describe, expect, test } from "bun:test";

import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// A value returned from a test, hook or describe callback is waited on the way `await` waits on it. A Promise
// subclass or a thenable settles through its own then(), which is where Bun.$ and a Bun.SQL query start their work.
describe.concurrent("a returned Promise subclass or thenable", () => {
  async function runFixture(name: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./returned-thenable-" + name + ".fixture.ts"],
      cwd: import.meta.dir + "/fixtures",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // No fixture waits on the runner. If the runner itself spins, the kill shows as `signalCode`.
      timeout: 20_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: normalizeBunSnapshot(stdout),
      // One line for each test result, each reported error, each timeout, and each total.
      results: normalizeBunSnapshot(stderr)
        .split("\n")
        .filter(line =>
          /^\((pass|fail)\) |^\w*[Ee]rror: |^# Unhandled |^ +\^ this test timed out|^ *\d+ (pass|fail|errors?)$/.test(
            line,
          ),
        ),
      exitCode,
      signalCode: proc.signalCode,
    };
  }

  test("is awaited through one then() call", async () => {
    expect(await runFixture("awaited")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "results": [
          "(pass) a thenable from > a test",
          "(pass) a thenable from > test.each row a",
          "(pass) a thenable from > test.each row b",
          "(pass) a lazy Promise subclass from > a test",
          "(pass) a hook that returns the thenable it stores > awaits it",
          "(pass) an already fulfilled Promise subclass",
          "(pass) a thenable whose then is a getter",
          "(pass) a function with a then()",
          "(pass) a thenable that resolves with a thenable",
          "(pass) a thenable that calls resolve, then reject",
          "(pass) a promise from another realm",
          "error: first attempt",
          "(pass) a rejection in the first attempt does not fail the retry (attempt 2)",
          "(pass) in a concurrent group > the first test returns a thenable",
          "(pass) in a concurrent group > the second test starts after that then()",
          "(pass) a Proxy: then is read once",
          "(pass) an object is a synchronous return",
          "(pass) an object whose then is not callable is a synchronous return",
          "(pass) an array is a synchronous return",
          "(pass) a function is a synchronous return",
          "(pass) a mock function is a synchronous return",
          "(pass) a string is a synchronous return",
          "(pass) a done callback with a thenable: then is not read, only done is awaited",
          "(pass) a done callback with a lazy Promise subclass: the subclass is started",
          "(pass) a native promise while Promise.prototype.then is replaced",
          "(pass) an object is a synchronous return after then was replaced",
          "(pass) an object whose then is not callable is a synchronous return after then was replaced",
          "(pass) an array is a synchronous return after then was replaced",
          "(pass) a function is a synchronous return after then was replaced",
          "(pass) a mock function is a synchronous return after then was replaced",
          "(pass) a string is a synchronous return after then was replaced",
          "(pass) every value was awaited in order, through one then() call",
          " 31 pass",
          " 0 fail",
        ],
        "signalCode": null,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("Bun.$ and a Bun.SQL query run, and fail the test when they reject", async () => {
    expect(await runFixture("builtin")).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "results": [
          "(pass) a Bun.$ command runs",
          "ShellError: Failed with exit code 3",
          "(fail) a Bun.$ command that fails",
          "(pass) a Bun.SQL query runs",
          "SQLiteError: no such table: missing",
          "(fail) a Bun.SQL query that fails",
          "(pass) the returned query created the table",
          "(pass) the runner started every command and query",
          " 4 pass",
          " 2 fail",
        ],
        "signalCode": null,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("fails the test or hook when it rejects", async () => {
    expect(await runFixture("rejected")).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "results": [
          "error: rejected thenable",
          "(fail) a thenable that rejects",
          "error: rejected on a later turn",
          "(fail) a thenable that rejects on a later turn",
          "error: forwarded rejection",
          "(fail) a thenable that forwards an already rejected promise",
          "error: reject before resolve",
          "(fail) a thenable that calls reject, then resolve",
          "error: rejected after resolve with a thenable",
          "(fail) a thenable that resolves with a thenable that rejects",
          "error: then() threw",
          "(fail) a thenable whose then() throws",
          "error: then getter threw",
          "(fail) a thenable whose then getter throws",
          "(fail) a thenable that never settles",
          "  ^ this test timed out after 20ms.",
          "error: rejected lazy subclass",
          "(fail) a lazy Promise subclass that rejects",
          "error: rejected in then()",
          "(fail) an already fulfilled Promise subclass whose then() rejects",
          "TypeError: executor did not take a resolve function",
          "(fail) a Promise subclass that then() cannot construct",
          "error: rejected without then",
          "(fail) a rejected Promise subclass whose then is not callable",
          "error: constructor getter threw",
          "(fail) a Promise subclass whose constructor getter throws",
          "error: constructor getter threw",
          "(fail) a Promise subclass whose constructor getter throws, with a done callback",
          "error: rejected row a",
          "(fail) test.each row a",
          "error: rejected row b",
          "(fail) test.each row b",
          "(pass) test.failing",
          "error: rejected beforeEach",
          "(fail) beforeEach > the test does not run",
          "error: rejected beforeAll",
          "(fail) beforeAll > (unnamed)",
          "(pass) the runner started the lazy promise",
          " 2 pass",
          " 18 fail",
        ],
        "signalCode": null,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("from describe: a Promise subclass is awaited, a thenable is not", async () => {
    expect(await runFixture("describe")).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "results": [
          "# Unhandled error between tests",
          "error: constructor getter threw",
          "(pass) a lazy Promise subclass from describe > is started by the runner, and the tests it adds belong to the describe",
          "(pass) a thenable from describe > is not awaited",
          " 2 pass",
          " 0 fail",
          " 1 error",
        ],
        "signalCode": null,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });
});
