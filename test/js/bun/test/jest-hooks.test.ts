import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

let hooks_run: string[] = [];

beforeAll(() => hooks_run.push("global beforeAll"));
beforeEach(() => hooks_run.push("global beforeEach"));
afterAll(() => hooks_run.push("global afterAll"));
afterEach(() => hooks_run.push("global afterEach"));

describe("describe scope", () => {
  beforeAll(() => hooks_run.push("describe beforeAll"));
  beforeEach(() => hooks_run.push("describe beforeEach"));
  afterAll(() => hooks_run.push("describe afterAll"));
  afterEach(() => hooks_run.push("describe afterEach"));

  it("should run after beforeAll/beforeEach in the correct order", () => {
    expect(hooks_run).toEqual(["global beforeAll", "describe beforeAll", "global beforeEach", "describe beforeEach"]);
  });

  it("should run after afterEach/afterAll in the correct order", () => {
    expect(hooks_run).toEqual([
      "global beforeAll",
      "describe beforeAll",
      "global beforeEach",
      "describe beforeEach",
      "describe afterEach",
      "global afterEach",
      "global beforeEach",
      "describe beforeEach",
    ]);
  });
});

describe("test jest hooks in bun-test", () => {
  describe("test beforeAll hook", () => {
    let animal = "tiger";

    beforeAll(() => {
      animal = "lion";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test beforeEach hook", () => {
    let animal = "tiger";

    beforeEach(() => {
      animal = "lion";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
      animal = "dog";
    });

    it("string should be re-set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test afterEach hook", () => {
    let animal = "tiger";

    afterEach(() => {
      animal = "lion";
    });

    it("string should not be set by hook", () => {
      expect(animal).toEqual("tiger");
      animal = "dog";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test afterAll hook", () => {
    let animal = "tiger";

    describe("test afterAll hook", () => {
      afterAll(() => {
        animal = "lion";
      });

      it("string should not be set by hook", () => {
        expect(animal).toEqual("tiger");
        animal = "dog";
      });
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test async hooks", async () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(async () => {
      beforeAllCalled += await 1;
    });

    beforeEach(async () => {
      beforeEachCalled += await 1;
    });

    afterAll(async () => {
      afterAllCalled += await 1;
    });

    afterEach(async () => {
      afterEachCalled += await 1;
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });

  describe("test done callback in hooks", () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(done => {
      setImmediate(() => {
        beforeAllCalled++;
        done();
      });
    });

    beforeEach(done => {
      setImmediate(() => {
        beforeEachCalled++;
        done();
      });
    });

    afterAll(done => {
      setImmediate(() => {
        afterAllCalled++;
        done();
      });
    });

    afterEach(done => {
      setImmediate(() => {
        afterEachCalled++;
        done();
      });
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });

  describe("test async hooks with done()", () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(async done => {
      beforeAllCalled += await 1;
      setTimeout(done, 1);
    });

    beforeEach(async done => {
      beforeEachCalled += await 1;
      setTimeout(done, 1);
    });

    afterAll(async done => {
      afterAllCalled += await 1;
      setTimeout(done, 1);
    });

    afterEach(async done => {
      afterEachCalled += await 1;
      setTimeout(done, 1);
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });

  describe("beforeEach, afterEach with test.todo()", () => {
    let beforeEachCalled = 0;
    let afterEachCalled = 0;

    beforeEach(() => {
      beforeEachCalled++;
    });

    afterEach(() => {
      afterEachCalled++;
    });

    it.todo("TODO test");

    it("should have not called beforeEach or afterEach for test.todo", () => {
      expect(beforeEachCalled).toEqual(1); // Called once just before this test
      expect(afterEachCalled).toEqual(0);
    });

    it("should have called afterEach for previous test", () => {
      expect(beforeEachCalled).toEqual(2); // Called once just before this test
      expect(afterEachCalled).toEqual(1);
    });
  });
});

// Regression test for #14135
// beforeAll should not run for skipped tests when using .only
test("regression #14135 - beforeAll should not run for skipped describe blocks", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/jest-hooks-14135.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeAll 2
    test 2"
  `);
  expect(exitCode).toBe(0);
});

// Regression test for #19758
// tests that beforeAll runs in order instead of immediately
test("regression #19758 - beforeAll runs in order instead of immediately", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/jest-hooks-19758.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    -- foo beforeAll
    -- bar beforeAll
    bar.1
    -- baz beforeAll
    baz.1"
  `);
  expect(exitCode).toBe(0);
});

// Regression test for #20980
// error in beforeEach should prevent the test from running
test("regression #20980 - error in beforeEach prevents test from running", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/jest-hooks-20980.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/js/bun/test/jest-hooks-20980.fixture.ts:
    error: 5
    5
    (fail) test 0

     0 pass
     1 fail
    Ran 1 test across 1 file."
  `);
  expect(exitCode).toBe(1);
});

// Regression test for #21830
// make sure beforeAll runs in the right order
test("regression #21830 - beforeAll runs in the right order", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/jest-hooks-21830.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    Create Show Tests pre
    Create Show Tests post
    Get Show Data Tests pre
    Get Show Data Tests post
    Show Deletion Tests pre
    Show Deletion test post"
  `);
  expect(exitCode).toBe(0);
});

// Regression test for #23133
// Passing HookOptions to lifecycle hooks should work
describe("regression #23133 - lifecycle hooks accept timeout options", () => {
  const logs: string[] = [];

  // Test beforeAll with object timeout option
  beforeAll(
    () => {
      logs.push("beforeAll with object timeout");
    },
    { timeout: 10_000 },
  );

  // Test beforeAll with numeric timeout option
  beforeAll(() => {
    logs.push("beforeAll with numeric timeout");
  }, 5000);

  // Test beforeEach with timeout option
  beforeEach(
    () => {
      logs.push("beforeEach");
    },
    { timeout: 10_000 },
  );

  // Test afterEach with timeout option
  afterEach(
    () => {
      logs.push("afterEach");
    },
    { timeout: 10_000 },
  );

  // Test afterAll with timeout option
  afterAll(
    () => {
      logs.push("afterAll");
    },
    { timeout: 10_000 },
  );

  test("lifecycle hooks accept timeout options", () => {
    expect(logs).toContain("beforeAll with object timeout");
    expect(logs).toContain("beforeAll with numeric timeout");
    expect(logs).toContain("beforeEach");
  });

  test("beforeEach runs before each test", () => {
    // beforeEach should have run twice now (once for each test)
    const beforeEachCount = logs.filter(l => l === "beforeEach").length;
    expect(beforeEachCount).toBe(2);
  });
});

// Regression test for #12250
// afterAll hook should run even with --bail flag
test.failing("regression #12250 - afterAll hook should run even with --bail flag", async () => {
  using dir = tempDir("test-12250", {
    "test.spec.ts": `
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('test', () => {
  beforeAll(async () => {
    console.log('Before');
  });

  afterAll(async () => {
    console.log('After');
  });

  it('should fail', async () => {
    expect(true).toBe(false);
  });

  it('should pass', async () => {
    expect(true).toBe(true);
  });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--bail", "test.spec.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The test should fail with exit code 1
  expect(exitCode).toBe(1);

  // Before hook should run
  expect(stdout).toContain("Before");

  // Currently failing: afterAll hook should run even with --bail
  // TODO: Remove .todo() when fixed
  expect(stdout).toContain("After");

  // Should bail out after first failure
  expect(stdout).toContain("Bailed out after 1 failure");
  expect(stdout).toContain("Ran 1 tests");
});

// Regression test for #12250
// afterAll hook runs normally without --bail flag
test("regression #12250 - afterAll hook runs normally without --bail flag", async () => {
  using dir = tempDir("test-12250-control", {
    "test.spec.ts": `
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('test', () => {
  beforeAll(async () => {
    console.log('Before');
  });

  afterAll(async () => {
    console.log('After');
  });

  it('should fail', async () => {
    expect(true).toBe(false);
  });

  it('should pass', async () => {
    expect(true).toBe(true);
  });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.spec.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The test should fail with exit code 1 (one test failed)
  expect(exitCode).toBe(1);

  // Before hook should run
  expect(stdout).toContain("Before");

  // Without --bail, afterAll should definitely run
  expect(stdout).toContain("After");

  // Without --bail, should NOT bail out early
  expect(stdout).not.toContain("Bailed out");
});
