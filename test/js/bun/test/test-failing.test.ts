import { fail } from "assert";
import { $ } from "bun";
import { bunExe } from "harness";
import path from "path";

const fixtureDir = path.join(import.meta.dir, "fixtures");
describe("test.failing", () => {
  it("is a function", () => {
    expect(test.failing).toBeFunction();
  });

  it("is an alias for it.failing", () => {
    expect(it.failing).toBe(test.failing);
  });

  it("requires a test function (unlike test.todo)", () => {
    expect(() => test.failing("test name")).toThrow("test.failing expects a function as the second argument");
  });

  it("passes if an error is thrown or a promise rejects ", async () => {
    const result = await $.cwd(fixtureDir)`${bunExe()} test ./failing-test-fails.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    expect(stderr).toContain(" 2 pass\n");
  });

  it("fails if no error is thrown or promise resolves", async () => {
    const result = await $.cwd(
      fixtureDir,
    ).nothrow()`FORCE_COLOR=0 ${bunExe()} test ./failing-test-passes.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    if (result.exitCode === 0) {
      fail("Expected exit code to be non-zero\n\n" + stderr);
    }
    expect(stderr).toContain(" 2 fail\n");
    expect(stderr.replaceAll(/ \[[\d.]+ms\]/g, "")).toMatchInlineSnapshot(`
      "
      failing-test-passes.fixture.ts:
      (fail) This should fail but it doesnt
        ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
      (fail) This should fail but it doesnt (async)
        ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works

       0 pass
       2 fail
       2 expect() calls
      Ran 2 tests across 1 file.
      "
    `);
  });

  it("timeouts still count as failures", async () => {
    const result = await $.cwd(fixtureDir).nothrow()`${bunExe()} test ./failing-test-timeout.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    if (result.exitCode === 0) {
      fail("Expected exit code to be non-zero\n\n" + stderr);
    }
    expect(stderr).toContain(" 0 pass\n");
    expect(stderr).toMatch(/timed out after \d+ms/i);
  });

  describe("when using a done() callback", () => {
    it("when a test throws, rejects, or passes an error to done(), the test passes", async () => {
      const result = await $.cwd(
        fixtureDir,
      ).nothrow()`${bunExe()} test ./failing-test-done-test-succeeds.fixture.ts`.quiet();
      const stderr = result.stderr.toString();
      try {
        expect(stderr).toContain("0 fail");
        expect(result.exitCode).toBe(0);
      } catch (e) {
        console.error(stderr);
        throw e;
      }
    });

    it("when the test doesn't throw, or otherwise fail, the test does not pass", async () => {
      const result = await $.cwd(
        fixtureDir,
      ).nothrow()`${bunExe()} test ./failing-test-done-test-fails.fixture.ts`.quiet();
      const stderr = result.stderr.toString();
      try {
        expect(stderr).toContain("0 pass");
        expect(result.exitCode).not.toBe(0);
      } catch (e) {
        console.error(stderr);
        throw e;
      }
    });
  });
});
