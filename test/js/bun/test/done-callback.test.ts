import { bunEnv, bunExe } from "harness";
import { join } from "path";

const fixtureDir = join(import.meta.dir, "fixtures", "done-cb");
var $$: typeof Bun.$;
const bunTest = (file: string) => $$`${bunExe()} test ${file}`.quiet();

beforeAll(() => {
  $$ = new Bun.$.Shell();
  $$.cwd(fixtureDir);
  $$.nothrow();
  $$.env({
    ...bunEnv,
    BUN_JSC_showPrivateScriptsInStackTraces: "0",
  } as unknown as Record<string, string | undefined>);
});

describe("basic done() usage", () => {
  describe("test will pass", () => {
    it("when done() is called with no args", done => {
      done();
    });

    for (const arg of [null, undefined]) {
      it(`when done() is called with ${arg}`, done => {
        done(arg);
      });
    }

    // NOTE: immediately-resolving promises hit a different codepath
    it("when a promise resolves then calls done()", done => {
      return Bun.sleep(5).then(done);
    });

    it("when a promise resolves immediately then calls done()", done => {
      return Promise.resolve().then(done);
    });

    it("when a promise resolves on next tick then calls done()", done => {
      return new Promise(resolve => {
        process.nextTick(() => resolve(done()));
      });
    });

    it("when done() is called on next tick()", done => {
      process.nextTick(done);
    });
  }); // </ test will pass>

  describe("test will fail", () => {
    it("done(err) fails the test", async () => {
      const result = await bunTest(`./done-should-fail.fixture.ts`);
      const stderr = result.stderr.toString();
      const stdout = result.stdout.toString();
      try {
        expect(stderr).toMatch(/ \d fail\n/);
        expect(stderr).toContain(" 0 pass\n");
        for (let i = 0; i < 5; i++) {
          expect(stderr).toContain(`error message ${i + 1}`);
        }
        expect(result.exitCode).toBe(1);
      } catch (e) {
        console.log(stdout);
        console.log(stderr);
        throw e;
      }
    });
  }); // </ test will fail>
}); // </ basic done() usage>

describe("done callbacks in sync tests", () => {
  it("test will not hang when done() is never called or called after timeout", async () => {
    const result = await bunTest("./done-timeout-sync.fixture.ts");
    const stderr = result.stderr.toString();
    const stdout = result.stdout.toString();

    try {
      expect(result.exitCode).toBe(1);
      expect(stderr).toContain(" 0 pass\n");
      expect(stderr).toContain("timed out after");
    } catch (e) {
      console.log(stdout);
      console.log(stderr);
      throw e;
    }
  });
}); // </ done callbacks in sync tests>

describe("done callbacks in async tests", () => {
  it("done() causes the test to fail when it should", async () => {
    const result = await bunTest("./done-infinity.fixture.ts");
    const stderr = result.stderr.toString();
    const stdout = result.stdout.toString();

    try {
      expect(stderr).toContain(" 7 fail\n");
      expect(stderr).toContain(" 0 pass\n");
    } catch (e) {
      console.log(stdout);
      console.log(stderr);
      throw e;
    }
  });

  it("calling done() then rejecting makes the test pass but makes `bun test` exit with 1", async () => {
    const result = await bunTest("./done-then-reject.fixture.ts");
    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(" 1 pass\n");
    expect(stderr).toContain(" 0 fail\n");
    expect(stderr).toContain("error message from test");
    expect(stderr).toContain("Unhandled error between tests");
  });
}); // </ done callbacks in async tests>

test("verify we print error messages passed to done callbacks", async () => {
  const fixtureName = "test-error-done-callback-fixture.ts";
  const { stdout, stderr } = await bunTest(`./${fixtureName}`);
  let stdoutStr = stdout
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(fixtureDir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");
  let stderrStr = stderr
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(fixtureDir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");

  expect(stdoutStr).toMatchInlineSnapshot(`
    "bun test <version>
    "
  `);
  expect(stderrStr).toMatchInlineSnapshot(`
    "
    ${fixtureName}:
    22 |   105,
    23 |   115,
    24 | );
    25 |
    26 | test("error done callback (sync)", done => {
    27 |   done(new Error(msg + "(sync)"));
    ^
    error: you should see this(sync)
    at <anonymous> (<dir>/${fixtureName}:27:8)
    (fail) error done callback (sync)
    27 |   done(new Error(msg + "(sync)"));
    28 | });
    29 |
    30 | test("error done callback (async with await)", async done => {
    31 |   await 1;
    32 |   done(new Error(msg + "(async with await)"));
    ^
    error: you should see this(async with await)
    at <anonymous> (<dir>/${fixtureName}:32:8)
    (fail) error done callback (async with await)
    32 |   done(new Error(msg + "(async with await)"));
    33 | });
    34 |
    35 | test("error done callback (async with Bun.sleep)", async done => {
    36 |   await Bun.sleep(0);
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    ^
    error: you should see this(async with Bun.sleep)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:37:8)
    (fail) error done callback (async with Bun.sleep)
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    38 | });
    39 |
    40 | test("error done callback (async)", done => {
    41 |   Promise.resolve().then(() => {
    42 |     done(new Error(msg + "(async)"));
    ^
    error: you should see this(async)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:42:10)
    (fail) error done callback (async)
    43 |   });
    44 | });
    45 |
    46 | test("error done callback (async, setTimeout)", done => {
    47 |   setTimeout(() => {
    48 |     done(new Error(msg + "(async, setTimeout)"));
    ^
    error: you should see this(async, setTimeout)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:48:10)
    (fail) error done callback (async, setTimeout)
    49 |   }, 0);
    50 | });
    51 |
    52 | test("error done callback (async, setImmediate)", done => {
    53 |   setImmediate(() => {
    54 |     done(new Error(msg + "(async, setImmediate)"));
    ^
    error: you should see this(async, setImmediate)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:54:10)
    (fail) error done callback (async, setImmediate)
    55 |   });
    56 | });
    57 |
    58 | test("error done callback (async, nextTick)", done => {
    59 |   process.nextTick(() => {
    60 |     done(new Error(msg + "(async, nextTick)"));
    ^
    error: you should see this(async, nextTick)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:60:10)
    (fail) error done callback (async, nextTick)
    62 | });
    63 |
    64 | test("error done callback (async, setTimeout, Promise.resolve)", done => {
    65 |   setTimeout(() => {
    66 |     Promise.resolve().then(() => {
    67 |       done(new Error(msg + "(async, setTimeout, Promise.resolve)"));
    ^
    error: you should see this(async, setTimeout, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:67:12)
    (fail) error done callback (async, setTimeout, Promise.resolve)
    70 | });
    71 |
    72 | test("error done callback (async, setImmediate, Promise.resolve)", done => {
    73 |   setImmediate(() => {
    74 |     Promise.resolve().then(() => {
    75 |       done(new Error(msg + "(async, setImmediate, Promise.resolve)"));
    ^
    error: you should see this(async, setImmediate, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:75:12)
    (fail) error done callback (async, setImmediate, Promise.resolve)

    0 pass
    9 fail
    Ran 9 tests across 1 files.
    "
  `);
});
