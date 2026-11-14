import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir, withoutAsanQuarantine } from "harness";
import { join } from "node:path";

const xml2js = require("xml2js");

describe("junit reporter", () => {
  it.each([false, true])("should generate valid junit xml for passing tests %s", async withCIEnvironmentVariables => {
    await using tmpDir = tempDir("junit", {
      "package.json": "{}",
      "passing.test.js": `
        describe("root describe", () => {
          it("should pass", () => {
            expect(1 + 1).toBe(2);
          });

          it("second test", () => {
            expect(1 + 1).toBe(2);
          });

          it("failing test", () => {
            expect(1 + 1).toBe(3);
          });

          it.skip("skipped test", () => {
            expect(1 + 1).toBe(2);
          });

          it.todo("todo test");

          describe("nested describe", () => {
            it("should pass inside nested describe", () => {
              expect(1 + 1).toBe(2);
            });

            it("should fail inside nested describe", () => {
              expect(1 + 1).toBe(3);
            });
          });
        });
      `,
      "test-2.test.js": `
        describe("root describe", () => {
          it("should pass", () => {
            expect(1 + 1).toBe(2);
          });

          it("failing test", () => {
            expect(1 + 1).toBe(3);
          });

          describe("nested describe", () => {
            it("should pass inside nested describe", () => {
              expect(1 + 1).toBe(2);
            });

            it("should fail inside nested describe", () => {
              expect(1 + 1).toBe(3);
            });
          });
        });
      `,
    });

    let env = bunEnv;

    if (withCIEnvironmentVariables) {
      env = {
        ...env,
        CI_JOB_URL: "https://ci.example.com/123",
        CI_COMMIT_SHA: "1234567890",
      };
    }

    const junitPath = `${tmpDir}/junit.xml`;
    const proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    const xmlContent = await file(junitPath).text();

    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result.testsuites).toBeDefined();
    expect(result.testsuites.testsuite).toBeDefined();

    let firstSuite = result.testsuites.testsuite[0];
    let secondSuite = result.testsuites.testsuite[1];

    if (firstSuite.$.name === "passing.test.js") {
      [firstSuite, secondSuite] = [secondSuite, firstSuite];
    }

    expect(firstSuite.$.name).toBe("test-2.test.js");
    expect(firstSuite.$.file).toBe("test-2.test.js");
    expect(firstSuite.$.tests).toBe("4");
    expect(firstSuite.$.failures).toBe("2");
    expect(firstSuite.$.skipped).toBe("0");
    expect(Number.parseFloat(firstSuite.$.time)).toBeGreaterThanOrEqual(0.0);

    const firstNestedSuite = firstSuite.testsuite[0];
    expect(firstNestedSuite.$.name).toBe("root describe");
    expect(firstNestedSuite.$.file).toBe("test-2.test.js");
    expect(firstNestedSuite.$.line).toBe("2");

    expect(firstNestedSuite.testcase[0].$.name).toBe("should pass");
    expect(firstNestedSuite.testcase[0].$.file).toBe("test-2.test.js");
    expect(firstNestedSuite.testcase[0].$.line).toBe("3");

    expect(secondSuite.$.name).toBe("passing.test.js");
    expect(secondSuite.$.file).toBe("passing.test.js");
    expect(secondSuite.$.tests).toBe("7");
    expect(secondSuite.$.failures).toBe("2");
    expect(secondSuite.$.skipped).toBe("2");
    expect(Number.parseFloat(secondSuite.$.time)).toBeGreaterThanOrEqual(0.0);

    const secondNestedSuite = secondSuite.testsuite[0];
    expect(secondNestedSuite.$.name).toBe("root describe");
    expect(secondNestedSuite.$.file).toBe("passing.test.js");
    expect(secondNestedSuite.$.line).toBe("2");

    const nestedTestCase = secondNestedSuite.testcase[0];
    expect(nestedTestCase.$.name).toBe("should pass");
    expect(nestedTestCase.$.file).toBe("passing.test.js");
    expect(nestedTestCase.$.line).toBe("3");

    expect(result.testsuites.$.tests).toBe("11");
    expect(result.testsuites.$.failures).toBe("4");
    expect(result.testsuites.$.skipped).toBe("2");
    expect(Number.parseFloat(result.testsuites.$.time)).toBeGreaterThanOrEqual(0.0);

    if (withCIEnvironmentVariables) {
      expect(firstSuite.properties).toHaveLength(1);
      expect(firstSuite.properties[0].property).toHaveLength(2);
      expect(firstSuite.properties[0].property[0].$.name).toBe("ci");
      expect(firstSuite.properties[0].property[0].$.value).toBe("https://ci.example.com/123");
      expect(firstSuite.properties[0].property[1].$.name).toBe("commit");
      expect(firstSuite.properties[0].property[1].$.value).toBe("1234567890");
    }
  });

  it("more scenarios", async () => {
    await using tmpDir = tempDir("junit-comprehensive", {
      "package.json": "{}",
      "comprehensive.test.js": `
        import { test, expect, describe } from "bun:test";

        describe("comprehensive test suite", () => {
          describe.each([
            [10, 5],
            [20, 10]
          ])("division suite %i / %i", (dividend, divisor) => {
            test("should divide correctly", () => {
              expect(dividend / divisor).toBe(dividend / divisor);
            });
          });

          describe.if(true)("conditional describe that runs", () => {
            test("nested test in conditional describe", () => {
              expect(2 + 2).toBe(4);
            });
          });

          describe.if(false)("conditional describe that skips", () => {
            test("nested test that gets skipped", () => {
              expect(2 + 2).toBe(4);
            });
          });

          test("basic passing test", () => {
            expect(1 + 1).toBe(2);
          });

          test("basic failing test", () => {
            expect(1 + 1).toBe(3);
          });

          test.skip("basic skipped test", () => {
            expect(1 + 1).toBe(2);
          });

          test.todo("basic todo test");

          test.each([
            [1, 2, 3],
            [2, 3, 5],
            [4, 5, 9]
          ])("addition %i + %i = %i", (a, b, expected) => {
            expect(a + b).toBe(expected);
          });

          test.each([
            ["hello", "world", "helloworld"],
            ["foo", "bar", "foobar"]
          ])("string concat %s + %s = %s", (a, b, expected) => {
            expect(a + b).toBe(expected);
          });

          test.if(true)("conditional test that runs", () => {
            expect(1 + 1).toBe(2);
          });

          test.if(false)("conditional test that skips", () => {
            expect(1 + 1).toBe(2);
          });

          test.skipIf(true)("skip if true", () => {
            expect(1 + 1).toBe(2);
          });

          test.skipIf(false)("skip if false", () => {
            expect(1 + 1).toBe(2);
          });

          test.todoIf(true)("todo if true");

          test.todoIf(false)("todo if false", () => {
            expect(1 + 1).toBe(2);
          });

          test.failing("test marked as failing", () => {
            expect(1 + 1).toBe(3);
          });

          test("should match this test", () => {
            expect(2 + 2).toBe(4);
          });

          test("should not be matched by filter", () => {
            expect(3 + 3).toBe(6);
          });
        });
      `,
    });
    console.log(tmpDir);

    const junitPath1 = `${tmpDir}/junit-all.xml`;
    const proc1 = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath1], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc1.exited;

    const xmlContent1 = await file(junitPath1).text();
    expect(filterJunitXmlOutput(xmlContent1)).toMatchSnapshot();
    const result1 = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent1, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result1.testsuites).toBeDefined();
    expect(result1.testsuites.testsuite).toBeDefined();

    const suite1 = result1.testsuites.testsuite[0];
    expect(suite1.$.name).toBe("comprehensive.test.js");
    expect(Number.parseInt(suite1.$.tests)).toBeGreaterThan(10);

    const junitPath2 = `${tmpDir}/junit-filtered.xml`;
    const proc2 = spawn(
      [bunExe(), "test", "-t", "should match", "--reporter=junit", "--reporter-outfile", junitPath2],
      {
        cwd: tmpDir,
        env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await proc2.exited;

    const xmlContent2 = await file(junitPath2).text();
    expect(filterJunitXmlOutput(xmlContent2)).toMatchSnapshot();
    const result2 = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent2, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const suite2 = result2.testsuites.testsuite[0];
    expect(suite2.$.name).toBe("comprehensive.test.js");
    expect(Number.parseInt(suite2.$.tests)).toBeGreaterThan(5);
    expect(Number.parseInt(suite2.$.skipped)).toBeGreaterThan(3);

    expect(xmlContent2).toContain("should match this test");
    // even though it's not matched, juint should still include it
    expect(xmlContent2).toContain("should not be matched by filter");

    expect(xmlContent1).toContain("addition 1 + 2 = 3");
    expect(xmlContent1).toContain("addition 2 + 3 = 5");
    expect(xmlContent1).toContain("addition 4 + 5 = 9");

    expect(xmlContent2).toContain("addition 1 + 2 = 3");
    expect(xmlContent2).toContain("conditional describe that skips");
    expect(xmlContent2).toContain("division suite 10 / 5");
    expect(xmlContent2).toContain("division suite 20 / 10");

    expect(xmlContent1).toContain("string concat hello + world = helloworld");
    expect(xmlContent1).toContain("string concat foo + bar = foobar");

    expect(xmlContent1).toContain("line=");
    expect(xmlContent2).toContain("line=");
  });

  it("should report the final result for a retried test, and the earlier attempts as Surefire does", async () => {
    await using tmpDir = tempDir("junit-retry", {
      "package.json": "{}",
      "flaky.test.js": `
        import { test, expect } from "bun:test";
        let attempt = 0;
        test("flaky test", { retry: 3 }, () => {
          attempt++;
          if (attempt < 3) {
            throw new Error("flaky failure attempt " + attempt);
          }
          expect(true).toBe(true);
        });

        let exhausted = 0;
        test("exhausted test", { retry: 2 }, () => {
          exhausted++;
          throw new Error("always fails " + exhausted);
        });

        test("stable test", () => {
          expect(1 + 1).toBe(2);
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // A test that passes after retries must not leave <failure> entries behind:
    // CI systems (Buildkite, Jenkins, GitLab) count every <failure> as a real
    // failure regardless of sibling passing entries for the same name.
    const flakyEntries = [...xmlContent.matchAll(/<testcase[^>]*name="flaky test"[^/]*(?:\/>|>[\s\S]*?<\/testcase>)/g)];
    expect(flakyEntries).toHaveLength(1);
    expect(flakyEntries[0][0]).not.toContain("<failure");
    expect([...flakyEntries[0][0].matchAll(/<flakyFailure type="Error" message="([^"]*)">/g)].map(m => m[1])).toEqual([
      "flaky failure attempt 1",
      "flaky failure attempt 2",
    ]);

    // A test that fails every retry attempt is reported once, as a failure,
    // and the failure message reflects the final attempt (not the first).
    const exhaustedEntries = [
      ...xmlContent.matchAll(/<testcase[^>]*name="exhausted test"[^/]*(?:\/>|>[\s\S]*?<\/testcase>)/g),
    ];
    expect(exhaustedEntries).toHaveLength(1);
    expect(
      [...exhaustedEntries[0][0].matchAll(/<(\w+) type="Error" message="([^"]*)">/g)].map(m => m.slice(1)),
    ).toEqual([
      ["failure", "always fails 3"],
      ["rerunFailure", "always fails 1"],
      ["rerunFailure", "always fails 2"],
    ]);

    expect(xmlContent).toContain('name="stable test"');

    // Suite/top-level counts must match the final outcomes (1 failure, 3 tests),
    // not the number of attempts.
    expect(result.testsuites.$.tests).toBe("3");
    expect(result.testsuites.$.failures).toBe("1");
    const suite = result.testsuites.testsuite[0];
    expect(suite.$.tests).toBe("3");
    expect(suite.$.failures).toBe("1");

    expect(proc.exitCode).toBe(1);
  });

  it("reports an attempt that timed out like any other failed attempt", async () => {
    await using tmpDir = tempDir("junit-retry-timeout", {
      "package.json": "{}",
      "timeout.test.js": `
        import { test } from "bun:test";
        const forever = new Promise(() => {});
        const attempts = {};
        const attempt = name => (attempts[name] = (attempts[name] ?? 0) + 1);

        test("times out, then throws", { retry: 1, timeout: 50 }, async () => {
          if (attempt("a") === 1) await forever;
          throw new Error("second attempt");
        });
        test("throws, then times out", { retry: 1, timeout: 50 }, async () => {
          if (attempt("b") === 1) throw new Error("first attempt");
          await forever;
        });
        test("times out, then passes", { retry: 1, timeout: 50 }, async () => {
          if (attempt("c") === 1) await forever;
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: String(tmpDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    const attemptsOf = name =>
      [
        ...xmlContent
          .match(new RegExp(`<testcase[^>]*name="${name}"[^/]*>[\\s\\S]*?</testcase>`))[0]
          .matchAll(/<(\w+) type="(\w+)" message="([^"]*)"/g),
      ].map(match => match.slice(1));
    expect({
      "times out, then throws": attemptsOf("times out, then throws"),
      "throws, then times out": attemptsOf("throws, then times out"),
      "times out, then passes": attemptsOf("times out, then passes"),
    }).toEqual({
      "times out, then throws": [
        ["failure", "Error", "second attempt"],
        ["rerunFailure", "TimeoutError", "test timed out"],
      ],
      "throws, then times out": [
        ["failure", "TimeoutError", "test timed out"],
        ["rerunFailure", "Error", "first attempt"],
      ],
      "times out, then passes": [["flakyFailure", "TimeoutError", "test timed out"]],
    });
    expect(proc.exitCode).toBe(1);
  });

  it("reports a concurrent test's earlier attempts under that test", async () => {
    await using tmpDir = tempDir("junit-retry-concurrent", {
      "package.json": "{}",
      "concurrent.test.js": `
        import { test } from "bun:test";
        const turn = () => new Promise(resolve => setImmediate(resolve));
        const retrying = Promise.withResolvers();
        const attempts = {};
        const attempt = name => (attempts[name] = (attempts[name] ?? 0) + 1);

        test.concurrent("fails once, and ends last", { retry: 1 }, async () => {
          if (attempt("a") === 1) throw new Error("first attempt of the last");
          retrying.resolve();
          for (let i = 0; i < 5; i++) await turn();
        });
        test.concurrent("fails once", { retry: 1 }, async () => {
          if (attempt("b") === 1) throw new Error("first attempt");
          await retrying.promise;
        });
        test.concurrent("passes", async () => {
          await retrying.promise;
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: String(tmpDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    const attemptsOf = name =>
      [
        ...xmlContent
          .match(new RegExp(`<testcase[^>]*name="${name}"[^/]*(?:/>|>[\\s\\S]*?</testcase>)`))[0]
          .matchAll(/<(\w+) type="(\w+)" message="([^"]*)"/g),
      ].map(match => match.slice(1));
    expect({
      "fails once, and ends last": attemptsOf("fails once, and ends last"),
      "fails once": attemptsOf("fails once"),
      "passes": attemptsOf("passes"),
    }).toEqual({
      "fails once, and ends last": [["flakyFailure", "Error", "first attempt of the last"]],
      "fails once": [["flakyFailure", "Error", "first attempt"]],
      "passes": [],
    });
    expect(proc.exitCode).toBe(0);
  });

  it("reports a concurrent test's error under that test", async () => {
    await using tmpDir = tempDir("junit-concurrent-errors", {
      "package.json": "{}",
      "concurrent.test.js": `
        import { afterEach, test } from "bun:test";
        const turn = () => new Promise(resolve => setImmediate(resolve));
        const thrown = Promise.withResolvers();

        // Keeps the first test open until the second one has thrown.
        afterEach(async () => {
          for (let i = 0; i < 5; i++) await turn();
        });
        test.concurrent("throws first", async () => {
          thrown.resolve();
          throw new Error("from the first");
        });
        test.concurrent("throws second", async () => {
          await thrown.promise;
          await turn();
          throw new Error("from the second");
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: String(tmpDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    const errorsOf = name =>
      xmlContent.match(new RegExp(`<testcase[^>]*name="${name}"[^/]*>[\\s\\S]*?</testcase>`))[0].match(/from the \w+/g);
    // Once in the message, once in the body.
    expect({ "throws first": errorsOf("throws first"), "throws second": errorsOf("throws second") }).toEqual({
      "throws first": ["from the first", "from the first"],
      "throws second": ["from the second", "from the second"],
    });
    expect(proc.exitCode).toBe(1);
  });

  it("reports an attempt that failed without an error like any other failed attempt", async () => {
    await using tmpDir = tempDir("junit-retry-no-error", {
      "package.json": "{}",
      // bun:test doesn't retry these failures.
      "no-error.test.js": `
        import { expect, test } from "vitest";
        const attempts = {};
        const attempt = name => (attempts[name] = (attempts[name] ?? 0) + 1);

        test("never has enough assertions", { retry: 1 }, () => {
          expect.assertions(2);
          expect(1).toBe(1);
        });
        test("has enough assertions the second time", { retry: 1 }, () => {
          expect.assertions(1);
          if (attempt("a") === 2) expect(1).toBe(1);
        });
        test("never has an assertion", { retry: 1 }, () => {
          expect.hasAssertions();
        });
        test("has an assertion the second time", { retry: 1 }, () => {
          expect.hasAssertions();
          if (attempt("b") === 2) expect(1).toBe(1);
        });
        test.fails("never fails", { retry: 1 }, () => {});
        test.fails("fails the second time", { retry: 1 }, () => {
          if (attempt("c") === 2) throw new Error("second attempt");
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: String(tmpDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    const attemptsOf = Object.fromEntries(
      Array.from(xmlContent.matchAll(/<testcase name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g), ([, name, attempts]) => [
        name,
        Array.from(attempts.matchAll(/<(\w+) type="(\w+)" message="([^"]*)"/g), match => match.slice(1)),
      ]),
    );
    const tooFew = count => ["AssertionError", `Expected more assertions, but only received ${count}`];
    const none = ["AssertionError", "Expected to have assertions, but none were run"];
    const didNotFail = ["AssertionError", "test marked with .fails() did not fail"];
    expect(attemptsOf).toEqual({
      "never has enough assertions": [
        ["failure", ...tooFew(1)],
        ["rerunFailure", ...tooFew(1)],
      ],
      "has enough assertions the second time": [["flakyFailure", ...tooFew(0)]],
      "never has an assertion": [
        ["failure", ...none],
        ["rerunFailure", ...none],
      ],
      "has an assertion the second time": [["flakyFailure", ...none]],
      "never fails": [
        ["failure", ...didNotFail],
        ["rerunFailure", ...didNotFail],
      ],
      "fails the second time": [["flakyFailure", ...didNotFail]],
    });
    expect(proc.exitCode).toBe(1);
  });

  it("omits U+FFFE and U+FFFF, which XML 1.0 forbids", async () => {
    await using tmpDir = tempDir("junit-noncharacters", {
      "package.json": "{}",
      "noncharacters.test.js": `
        import { describe, test } from "bun:test";
        describe("block [\\uFFFE\\uFFFF]", () => {
          test("test [\\uFFFE\\uFFFF]", () => {
            throw new Error("message [\\uFFFE\\uFFFF]");
          });
          test("\\uFFFD and \\u{1FFFE} are allowed, \\uFFFF", () => {});
        });
      `,
    });

    const junitPath = join(String(tmpDir), "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: String(tmpDir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const xmlContent = await file(junitPath).text();
    expect(xmlContent).not.toMatch(/[\uFFFE\uFFFF]/);
    const result = await xml2js.parseStringPromise(xmlContent, { strict: true });
    const block = result.testsuites.testsuite[0].testsuite[0];
    expect(block.$.name).toBe("block []");
    expect(block.testcase.map(testcase => testcase.$.name)).toEqual(["test []", "\uFFFD and \u{1FFFE} are allowed, "]);
    expect(block.testcase[0].failure[0].$.message).toBe("message []");
    expect(proc.exitCode).toBe(1);
  });

  it("produces well-formed XML when test names contain control characters", async () => {
    await using tmpDir = tempDir("junit-ctrl", {
      "package.json": "{}",
      "ctrl.test.js":
        'import { test } from "bun:test";\n' +
        'test("ctrl \\x00nul\\x1besc\\x07bell", () => { throw new Error("x"); });\n' +
        'test("keeps\\twhitespace\\nfine", () => {});\n',
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const xmlBytes = await file(junitPath).bytes();
    // Raw control characters (other than TAB/LF/CR) are not well-formed XML 1.0
    // and must not appear in the output at all.
    for (const c of [0x00, 0x07, 0x1b]) {
      expect(xmlBytes).not.toContain(c);
    }

    const xmlContent = new TextDecoder().decode(xmlBytes);
    // &#0; / &#27; are also illegal as numeric references in XML 1.0.
    expect(xmlContent).not.toMatch(/&#(0|7|27);/);

    // The report must parse as XML.
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const testcases = result.testsuites.testsuite[0].testcase;
    expect(testcases[0].$.name).toBe("ctrl nulescbell");
    // TAB and LF are valid XML Chars and should pass through untouched.
    expect(testcases[1].$.name).toBe("keeps\twhitespace\nfine");
    expect(exitCode).toBe(1);
  });

  it("escapes the classname attribute exactly once", async () => {
    await using tmpDir = tempDir("junit-escape", {
      "package.json": "{}",
      "escape.test.js": `
        import { describe, test } from "bun:test";
        describe("suite <a> & \\"b\\"", () => {
          describe("inner > stuff", () => {
            test("t", () => {});
          });
        });
      `,
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const xmlContent = await file(junitPath).text();
    // Double-escaping would produce &amp;lt; / &amp;amp; etc.
    expect(xmlContent).not.toContain("&amp;lt;");
    expect(xmlContent).not.toContain("&amp;amp;");
    expect(xmlContent).not.toContain("&amp;gt;");
    expect(xmlContent).not.toContain("&amp;quot;");

    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const fileSuite = result.testsuites.testsuite[0];
    const outer = fileSuite.testsuite[0];
    const inner = outer.testsuite[0];
    const tc = inner.testcase[0];
    // The classname should decode back to the original describe names joined by " > ".
    expect(outer.$.name).toBe('suite <a> & "b"');
    expect(tc.$.classname).toBe('inner > stuff > suite <a> & "b"');
    expect(exitCode).toBe(0);
  });

  it("keeps the test body's error in <failure> when afterEach also throws", async () => {
    await using tmpDir = tempDir("junit-aftereach", {
      "package.json": "{}",
      "after.test.js": `
        import { test, afterEach } from "bun:test";
        afterEach(() => { throw new Error("cleanup broke"); });
        test("t", () => { throw new Error("actual test failure"); });
      `,
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const xmlContent = await file(junitPath).text();
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const tc = result.testsuites.testsuite[0].testcase[0];
    // The primary failure (from the test body) should win type/message;
    // the afterEach error should be appended to the body.
    expect(tc.failure[0].$.message).toContain("actual test failure");
    expect(tc.failure[0]._).toContain("actual test failure");
    expect(tc.failure[0]._).toContain("cleanup broke");
    expect(exitCode).toBe(1);
  });

  it("includes the error type, message and stack in <failure>", async () => {
    await using tmpDir = tempDir("junit-failure", {
      "package.json": "{}",
      "fail.test.js": `
        import { test, expect } from "bun:test";
        test("thrown error", () => { throw new Error("boom: the important message"); });
        test("type error", () => { null.foo; });
        test("assertion", () => { expect(1).toBe(2); });
      `,
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      // FORCE_COLOR so the matcher builds a coloured message, to exercise the
      // ANSI-strip path.
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", FORCE_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const xmlContent = await file(junitPath).text();
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const testcases = result.testsuites.testsuite[0].testcase;
    expect(testcases).toHaveLength(3);

    const [thrown, typeErr, assertion] = testcases;

    expect(thrown.failure[0].$.type).toBe("Error");
    expect(thrown.failure[0].$.message).toContain("boom: the important message");
    expect(thrown.failure[0]._).toContain("boom: the important message");
    expect(thrown.failure[0]._).toContain("fail.test.js:3");

    expect(typeErr.failure[0].$.type).toBe("TypeError");
    expect(typeErr.failure[0].$.message).toContain("null is not an object");
    expect(typeErr.failure[0]._).toContain("fail.test.js:4");

    expect(assertion.failure[0].$.type).toBe("AssertionError");
    expect(assertion.failure[0].$.message).toContain("expect(received).toBe(expected)");
    expect(assertion.failure[0]._).toContain("Expected: 2");
    expect(assertion.failure[0]._).toContain("Received: 1");
    expect(assertion.failure[0]._).toContain("fail.test.js:5");

    // No ANSI escape sequences should leak into the report. escape_xml drops
    // the ESC byte, so a leak would surface as bare CSI residue.
    expect(xmlContent).not.toMatch(/\[[\d;]*[A-HJKSTfm]/);
    expect(exitCode).toBe(1);
  });

  it.each([
    [
      "a preload throws",
      ["--preload", "./setup.js"],
      `import { test } from "bun:test";\ntest("never runs", () => {});`,
      { type: "TypeError", message: "the preload broke <&>", at: "setup.js:1" },
    ],
    [
      "a test file throws while it loads",
      [],
      `import { test } from "bun:test";\nthrow new RangeError("the file broke");\ntest("never registered", () => {});`,
      { type: "RangeError", message: "the file broke", at: "broken.test.js:2" },
    ],
    [
      "a describe callback throws",
      [],
      `import { describe } from "bun:test";\ndescribe("group", () => {\n  throw new Error("describe broke");\n});`,
      { type: "Error", message: "describe broke", at: "broken.test.js:3" },
    ],
    [
      "a test file imports a module that doesn't exist",
      [],
      `import { test } from "bun:test";\nimport "./nowhere";\ntest("never registered", () => {});`,
      { type: "ResolveMessage", message: expect.stringContaining("Cannot find module './nowhere'"), at: "./nowhere" },
    ],
    [
      "a top-level import() finds no module",
      [],
      `import { test } from "bun:test";\nawait import("./nowhere");\ntest("never registered", () => {});`,
      { type: "ResolveMessage", message: expect.stringContaining("Cannot find module './nowhere'"), at: "./nowhere" },
    ],
    [
      "a test file has a syntax error",
      [],
      `import { test } from "bun:test";\nconst half = ;\ntest("never registered", () => {});`,
      { type: "BuildMessage", message: "Unexpected ;", at: "broken.test.js:2:14" },
    ],
    [
      "a module that a test file imports has a syntax error",
      [],
      `import { test } from "bun:test";\nimport "./half.js";\ntest("never registered", () => {});`,
      { type: "BuildMessage", message: "Unexpected ;", at: "half.js:1:14" },
    ],
  ])("reports a failed test case when %s", async (_, args, source, { type, message, at }) => {
    await using tmpDir = tempDir("junit-unhandled", {
      "package.json": "{}",
      "setup.js": `throw new TypeError("the preload broke <&>");`,
      "half.js": `const half = ;`,
      "broken.test.js": source,
    });
    const report = async extra => {
      const junitPath = join(tmpDir, `junit${extra.join("")}.xml`);
      await using proc = spawn(
        [bunExe(), "test", ...args, ...extra, "--reporter=junit", "--reporter-outfile", junitPath],
        { cwd: tmpDir, env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" }, stdout: "pipe", stderr: "pipe" },
      );
      const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { xml: filterJunitXmlOutput(await file(junitPath).text()), exitCode };
    };
    const [serial, parallel] = await Promise.all([report([]), report(["--parallel=2"])]);

    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(serial.xml, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    expect(result.testsuites.$).toMatchObject({ tests: "1", failures: "1" });
    const [suite] = result.testsuites.testsuite;
    expect(suite.$).toMatchObject({ name: "broken.test.js", tests: "1", failures: "1" });
    expect(suite.testcase).toHaveLength(1);
    expect(suite.testcase[0].$).toMatchObject({ name: "(unhandled error)", file: "broken.test.js" });
    expect(suite.testcase[0].failure[0].$).toEqual({ type, message });
    expect(suite.testcase[0].failure[0]._).toContain(at);
    expect(parallel.xml).toBe(serial.xml);
    expect([serial.exitCode, parallel.exitCode]).toEqual([1, 1]);
  });

  it("creates the folder of --reporter-outfile", async () => {
    await using tmpDir = tempDir("junit-outfile-folder", {
      "package.json": "{}",
      "a.test.js": `import { test } from "bun:test";\ntest("passes", () => {});`,
    });
    const junitPath = join(tmpDir, "reports", "unit", "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(await file(junitPath).text()).toContain(`<testcase name="passes"`);
    expect(exitCode).toBe(0);
  });

  it("prints a stack frame whose source is not a file path as-is in <failure>", async () => {
    // Longer than a path buffer on every platform (98302 bytes on Windows).
    const padding = 100_000;
    const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
    const dataUrl = "data:text/javascript;base64," + btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());
    const longPath = "/" + Buffer.alloc(padding, "y").toString();

    await using tmpDir = tempDir("junit-source-url", {
      "package.json": "{}",
      "source-url.test.js": `
        import { test } from "bun:test";
        const thrower = (name, sourceURL) =>
          (0, eval)("(function " + name + "() { throw new Error('boom'); })\\n//# sourceURL=" + sourceURL);
        test("data url", async function dataUrlTest() {
          const source = ${JSON.stringify(dataUrlModule)} + Buffer.alloc(${padding}, "x").toString();
          const m = await import("data:text/javascript;base64," + btoa(source));
          m.default();
        });
        test("sourceURL that is not a path", () => {
          thrower("fromSourceUrl", "webpack://app/./src/x.ts")();
        });
        test("sourceURL longer than a path", () => {
          thrower("fromLongPath", "/" + Buffer.alloc(${padding}, "y").toString())();
        });
        test("sourceURL that is a path", () => {
          thrower("fromPath", import.meta.dir.replaceAll("\\\\", "/") + "/virtual/../generated.js")();
        });
      `,
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(1);

    const xmlContent = await file(junitPath).text();
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const [dataUrlCase, sourceUrlCase, longPathCase, pathCase] = result.testsuites.testsuite[0].testcase;

    expect(dataUrlCase.failure[0]._).toContain(`at fromDataUrl (${dataUrl}:1:`);
    // The frame in the test file itself is still relative to the cwd.
    expect(dataUrlCase.failure[0]._).toContain("at dataUrlTest (source-url.test.js:");
    expect(sourceUrlCase.failure[0]._).toContain("at fromSourceUrl (webpack://app/./src/x.ts:1:");
    expect(longPathCase.failure[0]._).toContain(`at fromLongPath (${longPath}:1:`);
    expect(pathCase.failure[0]._).toContain("at fromPath (generated.js:1:");
  });

  describe.concurrent("--reporter-junit-suites", () => {
    const files = {
      "package.json": "{}",
      "a.test.js": `import { describe, expect, test } from "bun:test";
test("top-level", () => {
  expect(1).toBe(1);
});
describe("first block", () => {
  test("passes", () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
  });
  test.skip("skipped", () => {});
  test.todo("todo");
  describe("inner <&> block", () => {
    test("fails", () => {
      expect(1).toBe(2);
    });
    test.failing("failing that passes", () => {});
  });
  test("after inner", () => {});
});
describe("second block", () => {
  test("passes", () => {});
});
describe.each([1, 2])("each %i", () => {
  test("passes", () => {});
});
`,
      "b.test.js": `import { describe, test } from "bun:test";
describe("only block", () => {
  test("passes", () => {});
  describe("", () => {
    test("in a block with an empty title", () => {});
  });
});
`,
    };

    const flat = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="12" assertions="4" failures="2" skipped="2" time="#">
  <testsuite name="a.test.js" file="a.test.js" tests="10" assertions="4" failures="2" skipped="2" time="#">
    <properties>
      <property name="ci" value="https://ci.example.com/123" />
      <property name="commit" value="1234567890" />
    </properties>
    <testcase name="top-level" classname="a.test.js" time="#" file="a.test.js" line="2" assertions="1" />
    <testcase name="first block &gt; passes" classname="a.test.js" time="#" file="a.test.js" line="6" assertions="2" />
    <testcase name="first block &gt; skipped" classname="a.test.js" time="#" file="a.test.js" line="10" assertions="0">
      <skipped />
    </testcase>
    <testcase name="first block &gt; todo" classname="a.test.js" time="#" file="a.test.js" line="11" assertions="0">
      <skipped message="TODO" />
    </testcase>
    <testcase name="first block &gt; inner &lt;&amp;&gt; block &gt; fails" classname="a.test.js" time="#" file="a.test.js" line="13" assertions="1">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;&#10;      at a.test.js:14:17&#10;</failure>
    </testcase>
    <testcase name="first block &gt; inner &lt;&amp;&gt; block &gt; failing that passes" classname="a.test.js" time="#" file="a.test.js" line="16" assertions="0">
      <failure type="AssertionError" message="test marked with .failing() did not throw" />
    </testcase>
    <testcase name="first block &gt; after inner" classname="a.test.js" time="#" file="a.test.js" line="18" assertions="0" />
    <testcase name="second block &gt; passes" classname="a.test.js" time="#" file="a.test.js" line="21" assertions="0" />
    <testcase name="each 1 &gt; passes" classname="a.test.js" time="#" file="a.test.js" line="24" assertions="0" />
    <testcase name="each 2 &gt; passes" classname="a.test.js" time="#" file="a.test.js" line="24" assertions="0" />
  </testsuite>
  <testsuite name="b.test.js" file="b.test.js" tests="2" assertions="0" failures="0" skipped="0" time="#">
    <properties>
      <property name="ci" value="https://ci.example.com/123" />
      <property name="commit" value="1234567890" />
    </properties>
    <testcase name="only block &gt; passes" classname="b.test.js" time="#" file="b.test.js" line="3" assertions="0" />
    <testcase name="only block &gt;  &gt; in a block with an empty title" classname="b.test.js" time="#" file="b.test.js" line="5" assertions="0" />
  </testsuite>
</testsuites>
`;

    const normalize = xml =>
      xml.replaceAll(/ (hostname|timestamp)="[^"]*"/g, "").replaceAll(/ time="\d+(\.\d+)?(e-\d+)?"/g, ' time="#"');

    async function report(args, bunfig) {
      using dir = tempDir("junit-suites", bunfig ? { ...files, "bunfig.toml": bunfig } : files);
      await using proc = spawn([bunExe(), "test", ...args], {
        cwd: String(dir),
        env: { ...bunEnv, CI_JOB_URL: "https://ci.example.com/123", CI_COMMIT_SHA: "1234567890" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const outfile = file(join(String(dir), "junit.xml"));
      return { xml: (await outfile.exists()) ? normalize(await outfile.text()) : null, stderr, exitCode };
    }
    const junit = ["--reporter=junit", "--reporter-outfile=junit.xml"];

    it("flat writes one <testsuite> per file and puts the describe blocks in the name of the <testcase>", async () => {
      const { xml, exitCode } = await report([...junit, "--reporter-junit-suites=flat"]);
      expect(xml).toBe(flat);
      expect(exitCode).toBe(1);
    });

    it("flat writes the same report with --parallel", async () => {
      const { xml, exitCode } = await report([...junit, "--reporter-junit-suites=flat", "--parallel=2"]);
      expect(xml).toBe(flat);
      expect(exitCode).toBe(1);
    });

    it("nested is the default, and counts the same tests as flat", async () => {
      const [byDefault, nested, { xml: flat }] = await Promise.all([
        report(junit),
        report([...junit, "--reporter-junit-suites=nested"]),
        report([...junit, "--reporter-junit-suites=flat"]),
      ]);
      expect(nested.xml).toBe(byDefault.xml);
      expect(flat).not.toBe(byDefault.xml);
      const suiteNames = Array.from(byDefault.xml.matchAll(/^( *)<testsuite name="([^"]*)"/gm), m => m[1] + m[2]);
      expect(suiteNames).toEqual([
        "  a.test.js",
        "    first block",
        "      inner &lt;&amp;&gt; block",
        "    second block",
        "    each 1",
        "    each 2",
        "  b.test.js",
        "    only block",
      ]);
      // Attributes of <testsuites> and of each file's top-level <testsuite>.
      const totals = xml =>
        Array.from(xml.matchAll(/^ {0,2}<testsuites? name="[^"]*"(?: file="[^"]*")? (.*)>$/gm), m => m[1]);
      expect(totals(byDefault.xml)).toEqual(totals(flat));
      expect(totals(flat)).toHaveLength(3);
    });

    it("reads junitSuites from bunfig.toml", async () => {
      const { xml, exitCode } = await report([], `[test.reporter]\njunit = "junit.xml"\njunitSuites = "flat"\n`);
      expect(xml).toBe(flat);
      expect(exitCode).toBe(1);
    });

    it("the flag wins over bunfig.toml", async () => {
      const [overridden, nested] = await Promise.all([
        report(["--reporter-junit-suites=nested"], `[test.reporter]\njunit = "junit.xml"\njunitSuites = "flat"\n`),
        report(junit),
      ]);
      expect(overridden.xml).toBe(nested.xml);
      const { xml } = await report(
        ["--reporter-junit-suites=flat"],
        `[test.reporter]\njunit = "junit.xml"\njunitSuites = "nested"\n`,
      );
      expect(xml).toBe(flat);
    });

    it.each([[[]], [["--reporter-junit-suites=flat"]], [["--parallel=2"]]])(
      "every <testsuite> has the time its file started as its timestamp %j",
      async args => {
        using dir = tempDir("junit-timestamp", files);
        const before = Date.now();
        await using proc = spawn([bunExe(), "test", ...junit, ...args], {
          cwd: String(dir),
          env: bunEnv,
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
        const after = Date.now();
        const suites = (await file(join(String(dir), "junit.xml")).text()).match(/<testsuite [^>]*>/g);
        expect(suites.length).toBeGreaterThanOrEqual(2);
        for (const suite of suites) {
          const [, timestamp] = suite.match(/ timestamp="([^"]*)"/) ?? [];
          expect(timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
          expect(new Date(timestamp).toISOString()).toBe(timestamp);
          expect(Date.parse(timestamp)).toBeWithin(before, after + 1);
        }
      },
    );

    it.each([[[]], [["--parallel=2"]]])("a file with no tests has an empty <testsuite> %j", async args => {
      using dir = tempDir("junit-empty", {
        "empty.test.js": `export {};`,
        "one.test.js": `test("passes", () => {});`,
      });
      await using proc = spawn([bunExe(), "test", ...junit, ...args], {
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      const xml = await file(join(String(dir), "junit.xml")).text();
      expect(xml.match(/<testsuite name="[^"]*" file="[^"]*" tests="\d+"/g)).toEqual([
        `<testsuite name="empty.test.js" file="empty.test.js" tests="0"`,
        `<testsuite name="one.test.js" file="one.test.js" tests="1"`,
      ]);
      expect(exitCode).toBe(0);
    });

    it.each([[[]], [["--parallel=2"]]])(
      'marks an error that the test itself did not throw with uncaught="true" %j',
      async args => {
        using dir = tempDir("junit-uncaught", {
          "a.test.js": `
            let attempt = 0;
            test("throws", () => { throw new Error("thrown by the test"); });
            test("rejects", async () => { throw new Error("rejected by the test"); });
            test("its timer throws", async () => {
              const { promise, resolve } = Promise.withResolvers();
              setTimeout(() => { resolve(); throw new Error("thrown by a timer"); }, 1);
              await promise;
              await new Promise(resolve => setImmediate(resolve));
            });
            test("its timer throws once", async () => {
              if (attempt++) return;
              const { promise, resolve } = Promise.withResolvers();
              setTimeout(() => { resolve(); throw new Error("thrown by a timer once"); }, 1);
              await promise;
              await new Promise(resolve => setImmediate(resolve));
            }, { retry: 1 });
          `,
          "b.test.js": `test("passes", () => {});`,
        });
        await using proc = spawn([bunExe(), "test", ...junit, ...args], {
          cwd: String(dir),
          env: bunEnv,
          stdout: "ignore",
          stderr: "ignore",
        });
        const exitCode = await proc.exited;
        const xml = await file(join(String(dir), "junit.xml")).text();
        expect(xml.match(/<(failure|flakyFailure|rerunFailure) [^>]*>/g)).toEqual([
          `<failure type="Error" message="thrown by the test">`,
          `<failure type="Error" message="rejected by the test">`,
          `<failure type="Error" message="thrown by a timer" uncaught="true">`,
          `<flakyFailure type="Error" message="thrown by a timer once" uncaught="true">`,
        ]);
        expect(exitCode).toBe(1);
      },
    );

    it("rejects any other value", async () => {
      const [flag, bunfig] = await Promise.all([
        report([...junit, "--reporter-junit-suites=deep"]),
        report([], `[test.reporter]\njunit = "junit.xml"\njunitSuites = "deep"\n`),
      ]);
      expect(flag).toEqual({
        xml: null,
        stderr: `error: --reporter-junit-suites expects 'nested' or 'flat', received "deep"\n`,
        exitCode: 1,
      });
      expect(bunfig.stderr).toContain(`error: expected "junitSuites" to be "nested" or "flat" but received "deep"`);
      expect({ xml: bunfig.xml, exitCode: bunfig.exitCode }).toEqual({ xml: null, exitCode: 1 });
    });
  });

  it("prints a write error when the outfile is longer than the path buffer", async () => {
    // A bunfig value can be longer than the path buffer on every platform.
    const outfile = Buffer.alloc(100_000, "j").toString();
    await using tmpDir = tempDir("junit-outfile-too-long", {
      "package.json": "{}",
      "bunfig.toml": `[test.reporter]\njunit = "${outfile}"\n`,
      "passing.test.js": `
        import { test } from "bun:test";
        test("passes", () => {});
      `,
    });
    await using proc = spawn([bunExe(), "test"], { cwd: tmpDir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(`Failed to write JUnit report to ${outfile}`);
    expect(exitCode).toBe(0);
  });

  // Not concurrent: each test starts its `bun test` runs at once, and four tests at once make a run several times slower.
  describe("a describe block is one <testsuite>", () => {
    // Each test file says which process loaded it, and when.
    const sayLoaded = `require("node:fs").appendFileSync(process.env.LOADED, JSON.stringify({ file: import.meta.file, pid: process.pid, at: Date.now() }) + "\\n");\n`;

    async function report(files, args, env = bunEnv) {
      const fixtures = { "package.json": "{}" };
      for (const [name, source] of Object.entries(files)) fixtures[name] = source + sayLoaded;
      using dir = tempDir("junit-blocks", fixtures);
      const loadedPath = join(String(dir), "loaded");
      await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile=junit.xml", ...args], {
        cwd: String(dir),
        env: { ...env, LOADED: loadedPath },
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      const loaded = (await file(loadedPath).text()).trim().split("\n").map(JSON.parse);
      const raw = await file(join(String(dir), "junit.xml")).text();
      // Rejects for a report that is not well-formed.
      await new Promise((resolve, reject) => {
        xml2js.parseString(raw, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
      });
      return {
        raw,
        xml: filterJunitXmlOutput(raw),
        exitCode,
        loaded,
        // With one test file, `bun test --parallel` loads the file itself and starts no worker.
        usedWorkers: !loaded.some(({ pid }) => pid === proc.pid),
      };
    }

    // The <testsuite> and <testcase> elements of each file, one per line, indented as they are nested.
    function outline(xml) {
      const files = {};
      let lines;
      for (const [, indent, element, name, attributes] of xml.matchAll(
        /^( *)<(testsuite|testcase) name="([^"]*)"([^>]*)>$/gm,
      )) {
        const attribute = key => attributes.match(new RegExp(` ${key}="([^"]*)"`))?.[1];
        if (indent.length === 2) lines = files[name] = [];
        const line = attribute("line") ? ` line=${attribute("line")}` : "";
        lines.push(
          indent.slice(2) +
            (element === "testcase"
              ? `case ${name.replaceAll("&gt;", ">")}`
              : `suite ${name}${line} tests=${attribute("tests")} failures=${attribute("failures")}`),
        );
      }
      return files;
    }

    // Attributes of <testsuites> and of each file's <testsuite>.
    const totals = xml =>
      Array.from(xml.matchAll(/^ {0,2}<testsuites? name="[^"]*"(?: file="[^"]*")? (.*)>$/gm), m => m[1]);

    // Lets a concurrent test end after the runner has reported another one, without waiting for time to pass.
    const turns = `const turn = () => new Promise(resolve => setImmediate(resolve));
const turns = async () => { for (let i = 0; i < 5; i++) await turn(); };`;

    // `endInOrder(order)(name)` is a test that ends after the runner has reported the tests before `name` in `order`.
    const endInOrder = `function endInOrder(order) {
  const ended = order.map(() => Promise.withResolvers());
  return name => async () => {
    const at = order.indexOf(name);
    if (at > 0) {
      await ended[at - 1].promise;
      await turns();
    }
    ended[at].resolve();
  };
}`;

    const noBlock = `import { test } from "bun:test";
test("not in a block", () => {});
`;

    it("whatever the order of the tests and of the errors outside of a test", async () => {
      const files = {
        "hook-each.test.js": `import { afterEach, describe, test } from "bun:test";
describe("d", () => {
  afterEach(done => {
    done(new Error("from afterEach"));
  });
  test("a", () => {});
  test("b", () => {});
});
`,
        "hook-all.test.js": `import { beforeAll, describe, test } from "bun:test";
describe("outer", () => {
  test("o1", () => {});
  describe("inner", () => {
    beforeAll(done => {
      done(new Error("from beforeAll"));
    });
    test("i1", () => {});
  });
  test("o2", () => {});
});
`,
        "timer.test.js": `import { describe, test } from "bun:test";
${turns}
describe("d", () => {
  test.concurrent("a", async () => {});
  test.concurrent("b", async () => {
    await turns();
    const thrown = Promise.withResolvers();
    setImmediate(() => {
      thrown.resolve();
      throw new Error("from a timer");
    });
    await thrown.promise;
    await turns();
  });
});
`,
        "concurrent.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
const end = endInOrder(["a1", "b1", "a2"]);
describe("a", () => {
  test.concurrent("a1", end("a1"));
  test.concurrent("a2", end("a2"));
});
describe("b", () => {
  test.concurrent("b1", end("b1"));
});
`,
        // Both rows report before "third" does, and a row reports again after it.
        "rows.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
const end = endInOrder(["a of 0", "a of 1", "in third", "b of 1", "b of 0"]);
describe.each([0, 1])("row", row => {
  test.concurrent("a of " + row, end("a of " + row));
  test.concurrent("b of " + row, end("b of " + row));
});
describe("third", () => {
  test.concurrent("in third", end("in third"));
});
`,
        // "y" is between the two "x" in the report, although the case before the second "x" is in the first.
        "adjacent.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
const end = endInOrder(["x1", "y1", "x2", "again"]);
describe("x", () => {
  test.concurrent("x1", end("x1"));
  test.concurrent("x2", end("x2"));
});
describe("y", () => {
  test.concurrent("y1", end("y1"));
});
describe("x", () => {
  test.concurrent("again", end("again"));
});
`,
        "same-name.test.js": `import { describe, test } from "bun:test";
describe.each([1, 2])("each", row => {
  test("of row " + row, () => {});
});
describe("twice", () => {
  test("in the first", () => {});
});
describe("twice", () => {
  test("in the second", () => {});
});
function helper(name) {
  describe("helper", () => {
    test(name, () => {});
  });
}
helper("first call");
describe("other", () => {
  test("between", () => {});
});
helper("second call");
`,
      };
      const [serial, parallel, flat] = await Promise.all([
        report(files, []),
        report(files, ["--parallel=2"]),
        report(files, ["--reporter-junit-suites=flat"]),
      ]);

      // The flat form has the cases in the order reported.
      expect(outline(flat.xml)).toEqual({
        "adjacent.test.js": [
          "suite adjacent.test.js tests=4 failures=0",
          "  case x > x1",
          "  case y > y1",
          "  case x > x2",
          "  case x > again",
        ],
        "concurrent.test.js": [
          "suite concurrent.test.js tests=3 failures=0",
          "  case a > a1",
          "  case b > b1",
          "  case a > a2",
        ],
        "hook-all.test.js": [
          "suite hook-all.test.js tests=4 failures=1",
          "  case outer > o1",
          "  case (unhandled error)",
          "  case outer > inner > i1",
          "  case outer > o2",
        ],
        "hook-each.test.js": [
          "suite hook-each.test.js tests=4 failures=2",
          "  case (unhandled error)",
          "  case d > a",
          "  case (unhandled error)",
          "  case d > b",
        ],
        "rows.test.js": [
          "suite rows.test.js tests=5 failures=0",
          "  case row > a of 0",
          "  case row > a of 1",
          "  case third > in third",
          "  case row > b of 1",
          "  case row > b of 0",
        ],
        "same-name.test.js": [
          "suite same-name.test.js tests=7 failures=0",
          "  case each > of row 1",
          "  case each > of row 2",
          "  case twice > in the first",
          "  case twice > in the second",
          "  case helper > first call",
          "  case other > between",
          "  case helper > second call",
        ],
        "timer.test.js": [
          "suite timer.test.js tests=3 failures=1",
          "  case d > a",
          "  case (unhandled error)",
          "  case d > b",
        ],
      });
      // An error outside of a test stays a case of the file, where it was reported among the file's blocks and cases.
      // Two blocks with one name share a <testsuite> when nothing is between them in the report, as before.
      expect(outline(serial.xml)).toEqual({
        "adjacent.test.js": [
          "suite adjacent.test.js tests=4 failures=0",
          "  suite x line=16 tests=2 failures=0",
          "    case x1",
          "    case x2",
          "  suite y line=20 tests=1 failures=0",
          "    case y1",
          "  suite x line=23 tests=1 failures=0",
          "    case again",
        ],
        "concurrent.test.js": [
          "suite concurrent.test.js tests=3 failures=0",
          "  suite a line=16 tests=2 failures=0",
          "    case a1",
          "    case a2",
          "  suite b line=20 tests=1 failures=0",
          "    case b1",
        ],
        "hook-all.test.js": [
          "suite hook-all.test.js tests=4 failures=1",
          "  suite outer line=2 tests=3 failures=0",
          "    case o1",
          "    suite inner line=4 tests=1 failures=0",
          "      case i1",
          "    case o2",
          "  case (unhandled error)",
        ],
        "hook-each.test.js": [
          "suite hook-each.test.js tests=4 failures=2",
          "  case (unhandled error)",
          "  suite d line=2 tests=2 failures=0",
          "    case a",
          "    case b",
          "  case (unhandled error)",
        ],
        "rows.test.js": [
          "suite rows.test.js tests=5 failures=0",
          "  suite row line=16 tests=4 failures=0",
          "    case a of 0",
          "    case a of 1",
          "    case b of 1",
          "    case b of 0",
          "  suite third line=20 tests=1 failures=0",
          "    case in third",
        ],
        "same-name.test.js": [
          "suite same-name.test.js tests=7 failures=0",
          "  suite each line=2 tests=2 failures=0",
          "    case of row 1",
          "    case of row 2",
          "  suite twice line=5 tests=2 failures=0",
          "    case in the first",
          "    case in the second",
          "  suite helper line=12 tests=1 failures=0",
          "    case first call",
          "  suite other line=17 tests=1 failures=0",
          "    case between",
          "  suite helper line=12 tests=1 failures=0",
          "    case second call",
        ],
        "timer.test.js": [
          "suite timer.test.js tests=3 failures=1",
          "  suite d line=4 tests=2 failures=0",
          "    case a",
          "    case b",
          "  case (unhandled error)",
        ],
      });
      expect(parallel.xml).toBe(serial.xml);
      expect(totals(serial.xml)).toEqual(totals(flat.xml));
      expect(totals(flat.xml)).toHaveLength(8);
      expect([serial.usedWorkers, parallel.usedWorkers]).toEqual([false, true]);
      expect([serial.exitCode, parallel.exitCode, flat.exitCode]).toEqual([1, 1, 1]);
    });

    it("in every order in which the tests of three blocks can end", async () => {
      const orders = [["a1"]];
      for (const name of ["i1", "a2", "b1"]) {
        for (const order of orders.splice(0)) {
          for (let at = 0; at <= order.length; at++) orders.push(order.toSpliced(at, 0, name));
        }
      }
      const files = {
        "orders.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
for (const order of ${JSON.stringify(orders)}) {
  const end = endInOrder(order);
  describe(order.join(" "), () => {
    describe("a", () => {
      test.concurrent("a1", end("a1"));
      describe("inner", () => {
        test.concurrent("i1", end("i1"));
      });
      test.concurrent("a2", end("a2"));
    });
    describe("b", () => {
      test.concurrent("b1", end("b1"));
    });
  });
}
`,
      };
      const [nested, flat] = await Promise.all([report(files, []), report(files, ["--reporter-junit-suites=flat"])]);

      // The flat form has the cases in the order reported.
      const reported = outline(flat.xml)["orders.test.js"].slice(1);
      expect(orders.map(order => reported.filter(line => line.startsWith(`  case ${order.join(" ")} > `)))).toEqual(
        orders.map(order =>
          order.map(name => `  case ${order.join(" ")} > ${name === "i1" ? "a > inner" : name[0]} > ${name}`),
        ),
      );
      // Each <testsuite> and <testcase> with the names of the suites around it. Which block reports first decides
      // the order of two blocks.
      const around = [];
      const elements = [];
      for (const line of outline(nested.xml)["orders.test.js"].slice(1)) {
        const [, indent, element, name, tests] = line.match(/^( *)(suite|case) (.*?)(?: line=\d+ (tests=\d+) .*)?$/);
        around.length = indent.length / 2 - 1;
        if (element === "suite") around.push(name);
        elements.push(element === "suite" ? `${around.join(" > ")} ${tests}` : `${around.join(" > ")} has ${name}`);
      }
      const once = orders
        .flatMap(order => {
          const block = order.join(" ");
          return [
            `${block} tests=4`,
            `${block} > a tests=3`,
            `${block} > a has a1`,
            `${block} > a has a2`,
            `${block} > a > inner tests=1`,
            `${block} > a > inner has i1`,
            `${block} > b tests=1`,
            `${block} > b has b1`,
          ];
        })
        .sort();
      expect(orders).toHaveLength(24);
      expect(elements.sort()).toEqual(once);
      expect([nested.exitCode, flat.exitCode]).toEqual([0, 0]);
    });

    it("with --rerun-each, when a block gets the address that a block of the run before had", async () => {
      const files = {
        "concurrent.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
const end = endInOrder(["a1", "b1", "a2"]);
describe("a", () => {
  test.concurrent("a1", end("a1"));
  test.concurrent("a2", end("a2"));
});
describe("b", () => {
  test.concurrent("b1", end("b1"));
});
`,
        "many.test.js": `import { describe, test } from "bun:test";
for (let block = 0; block < 50; block++) {
  describe("block " + block, () => {
    test("in block " + block, () => {});
  });
}
`,
        "stamps.test.js": `import { describe, test } from "bun:test";
describe("first", () => {
  // The next run starts in a later millisecond than this one was loaded in.
  test("until the clock moves", () => {
    const now = Date.now();
    while (Date.now() === now);
  });
});
describe("second", () => {
  test("b", () => {});
});
`,
        "wrapped.test.js": `import { describe, test } from "bun:test";
describe("outer", () => {
  describe("x", () => {
    test("x1", () => {});
  });
  describe("y", () => {
    test("y1", () => {});
  });
});
`,
      };
      // Without ASAN's quarantine, a block of the second run can get the address that a block of the first run had.
      const env = withoutAsanQuarantine(bunEnv);
      const [serial, parallel] = await Promise.all([
        report(files, ["--rerun-each=2"], env),
        report(files, ["--rerun-each=2", "--parallel=2"], env),
      ]);

      const many = Array.from({ length: 50 }, (_, block) => [
        `  suite block ${block} line=3 tests=1 failures=0`,
        `    case in block ${block}`,
      ]).flat();
      // The block around a whole file is one <testsuite> for all the runs, as before.
      expect(outline(serial.xml)).toEqual({
        "concurrent.test.js": [
          "suite concurrent.test.js tests=6 failures=0",
          "  suite a line=16 tests=2 failures=0",
          "    case a1",
          "    case a2",
          "  suite b line=20 tests=1 failures=0",
          "    case b1",
          "  suite a line=16 tests=2 failures=0",
          "    case a1",
          "    case a2",
          "  suite b line=20 tests=1 failures=0",
          "    case b1",
        ],
        "many.test.js": ["suite many.test.js tests=100 failures=0", ...many, ...many],
        "stamps.test.js": [
          "suite stamps.test.js tests=4 failures=0",
          "  suite first line=2 tests=1 failures=0",
          "    case until the clock moves",
          "  suite second line=9 tests=1 failures=0",
          "    case b",
          "  suite first line=2 tests=1 failures=0",
          "    case until the clock moves",
          "  suite second line=9 tests=1 failures=0",
          "    case b",
        ],
        "wrapped.test.js": [
          "suite wrapped.test.js tests=4 failures=0",
          "  suite outer line=2 tests=4 failures=0",
          "    suite x line=3 tests=1 failures=0",
          "      case x1",
          "    suite y line=6 tests=1 failures=0",
          "      case y1",
          "    suite x line=3 tests=1 failures=0",
          "      case x1",
          "    suite y line=6 tests=1 failures=0",
          "      case y1",
        ],
      });
      expect(parallel.xml).toBe(serial.xml);
      // The timestamp of a block is the start of the run in which it reported.
      const loads = serial.loaded.filter(({ file }) => file === "stamps.test.js").map(({ at }) => at);
      const stamps = Array.from(
        serial.raw.matchAll(/<testsuite name="(first|second)" file="stamps\.test\.js"[^>]* timestamp="([^"]*)">/g),
        ([, name, timestamp]) => [name, loads.findIndex(loaded => Date.parse(timestamp) <= loaded)],
      );
      expect(stamps).toEqual([
        ["first", 0],
        ["second", 0],
        ["first", 1],
        ["second", 1],
      ]);
      expect([serial.usedWorkers, parallel.usedWorkers]).toEqual([false, true]);
      expect([serial.exitCode, parallel.exitCode]).toEqual([0, 0]);
    });

    it("when --bail ends the run inside it", async () => {
      const { xml, exitCode } = await report(
        {
          "a.test.js": `import { describe, test } from "bun:test";
${turns}
${endInOrder}
const end = endInOrder(["a1", "b1", "a2 fails"]);
describe("a", () => {
  test.concurrent("a1", end("a1"));
  test.concurrent("a2 fails", async () => {
    await end("a2 fails")();
    throw new Error("from the test");
  });
});
describe("b", () => {
  test.concurrent("b1", end("b1"));
});
test("never runs", () => {});
`,
          "b.test.js": noBlock,
        },
        ["--bail=1"],
      );

      expect(outline(xml)).toEqual({
        "a.test.js": [
          "suite a.test.js tests=3 failures=1",
          "  suite a line=16 tests=2 failures=1",
          "    case a1",
          "    case a2 fails",
          "  suite b line=23 tests=1 failures=0",
          "    case b1",
        ],
      });
      expect(exitCode).toBe(1);
    });
  });
});

function filterJunitXmlOutput(xmlContent) {
  return xmlContent.replaceAll(/ (time|hostname|timestamp)=".*?"/g, "");
}
