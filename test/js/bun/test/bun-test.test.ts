import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});

// Fuzzer-found crash: Bun.jest() without an active test runner, followed by
// misuse of the expect statics, must not crash the process. In particular,
// `new` on a matcher registered via expect.extend() used to jump to a null
// native constructor and SIGSEGV.
test("Bun.jest() expect statics do not crash on misuse", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const jestExpect = Bun.jest().expect;
jestExpect.extend({ customMatcher() { return { pass: true, message: () => "" }; } });
try { new jestExpect.customMatcher(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { new (jestExpect(1).customMatcher)(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
try { jestExpect.extend(); } catch {}
const arrayContaining = jestExpect.arrayContaining;
try { new arrayContaining(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
Bun.gc(true);
console.log("OK");`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

// toBeWithin() with one argument used to index past the argument slice and
// abort the process instead of failing the test.
test("toBeWithin() with missing or non-number arguments fails the test without crashing", async () => {
  using dir = tempDir("to-be-within-args", {
    "within.test.ts": `
      import { test, expect } from "bun:test";

      test("one argument", () => {
        expect(1).toBeWithin(0);
      });

      test("no arguments", () => {
        expect(1).toBeWithin();
      });

      test("start is not a number", () => {
        expect(1).toBeWithin("0", 2);
      });

      test("end is not a number", () => {
        expect(1).toBeWithin(0, "2");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "within.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("toBeWithin() requires the first argument to be a number");
  expect(stderr).toContain("toBeWithin() requires the second argument to be a number");
  expect(stderr).toContain("4 fail");
  expect(exitCode).toBe(1);
});

test.concurrent("runs the next test after a retried test rejects with a value that throws when inspected", async () => {
  using dir = tempDir("test-retry-inspect-throws", {
    "retry.test.js": `
      import { test, expect } from "bun:test";
      import { inspect } from "node:util";

      const doc = { [inspect.custom]() { throw new Error("inspect"); } };
      let attempts = 0;

      test("flaky", async () => {
        if (attempts++ === 0) throw { status: 400, doc };
      }, { retry: 2 });

      test("must fail", () => {
        console.log("must fail body ran");
        expect(1).toBe(2);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "retry.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.split("\n").slice(1).join("\n"),
    summary: stderr.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim()),
    exitCode,
  }).toEqual({
    stdout: "must fail body ran\n",
    summary: ["1 pass", "1 fail"],
    exitCode: 1,
  });
});

// A matcher that needs a promise returns one. Its test is not done before that promise has settled.
test("a promise matcher that is not awaited counts against its own test", async () => {
  using dir = tempDir("unawaited-matchers", {
    "unawaited.test.ts": `
      import { test, expect } from "bun:test";
      const later = value => new Promise(resolve => setImmediate(resolve, value));
      expect.extend({
        async toBeLater(received, expected) {
          await later();
          return { pass: received === expected, message: () => received + " is not " + expected };
        },
      });

      test("resolves fails", () => {
        expect(later(1)).resolves.toBe(2);
      });
      test("nothing to do with it 1", () => {});
      test("toThrow fails", () => {
        expect(async () => void (await later())).toThrow("never");
      });
      test("nothing to do with it 2", () => {});
      test("custom matcher fails", () => {
        expect(1).toBeLater(2);
      });
      test("they pass and are counted", () => {
        expect.assertions(3);
        expect(later(1)).resolves.toBe(1);
        expect(later().then(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
        expect(1).toBeLater(1);
      });
      test("done() does not end it either", done => {
        expect(later(1)).resolves.toBe(3);
        done();
      });
      test("never settles", () => {
        expect(new Promise(() => {})).resolves.toBe(1);
      }, 50);
      test("nothing to do with it 3", () => {});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "unawaited.test.ts"],
    env: { ...bunEnv, AGENT: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(
    stderr
      .split(/\r?\n/)
      .filter(line => /^\((pass|fail)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
  ).toEqual([
    "(fail) resolves fails",
    "(pass) nothing to do with it 1",
    "(fail) toThrow fails",
    "(pass) nothing to do with it 2",
    "(fail) custom matcher fails",
    "(pass) they pass and are counted",
    "(fail) done() does not end it either",
    "(fail) never settles",
    "(pass) nothing to do with it 3",
  ]);
  expect(stderr).not.toContain("Unhandled error between tests");
  expect(exitCode).toBe(1);
});

// Such a failure is raised from a promise reaction, which has no caller.
test("the failure of a promise matcher points at the matcher call", async () => {
  using dir = tempDir("promise-matcher-stack", {
    "stack.test.ts": `import { test, expect } from "bun:test";
const later = value => new Promise(resolve => setImmediate(resolve, value));
const stackOf = promise => promise.then(() => "fulfilled", error => error.stack.split("\\n").find(line => line.includes("stack.test.ts")).replace(/^.*stack\\.test\\.ts:/, "").replace(")", ""));
expect.extend({
  async toBeLater() {
    await later();
    return { pass: false, message: () => "no" };
  },
});
function throwsItsOwn() {
  throw new Error("its own"); // line 11
}
test("stacks", async () => {
  console.log(JSON.stringify([
    await stackOf(expect(later(1)).resolves.toBe(2)), // line 15
    await stackOf(expect(async () => void (await later())).toThrow()),
    await stackOf(expect(1).toBeLater()),
    // An error that has a stack keeps it.
    await stackOf(expect(later(1)).resolves.toSatisfy(throwsItsOwn)),
  ]));
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "stack.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout.split(/\r?\n/).find(line => line.startsWith("["))!)).toEqual([
    "15:45",
    "16:60",
    "17:29",
    "11:13",
  ]);
  expect(exitCode).toBe(0);
});
