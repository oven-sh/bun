import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";

const xml2js = require("xml2js");

describe("junit reporter", () => {
  it.each([false, true])("should generate valid junit xml for passing tests %s", async withCIEnvironmentVariables => {
    const tmpDir = tempDirWithFiles("junit", {
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
    const tmpDir = tempDirWithFiles("junit-comprehensive", {
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

  it("should report only the final result for a retried test", async () => {
    const tmpDir = tempDirWithFiles("junit-retry", {
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

    // A test that fails every retry attempt is reported once, as a failure,
    // and the failure message reflects the final attempt (not the first).
    const exhaustedEntries = [
      ...xmlContent.matchAll(/<testcase[^>]*name="exhausted test"[^/]*(?:\/>|>[\s\S]*?<\/testcase>)/g),
    ];
    expect(exhaustedEntries).toHaveLength(1);
    expect(exhaustedEntries[0][0]).toContain("<failure");
    expect(exhaustedEntries[0][0]).toContain("always fails 3");
    expect(exhaustedEntries[0][0]).not.toContain("always fails 1");

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

  it("produces well-formed XML when test names contain control characters", async () => {
    const tmpDir = tempDirWithFiles("junit-ctrl", {
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
    const tmpDir = tempDirWithFiles("junit-escape", {
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

  it("includes the error type, message and stack in <failure>", async () => {
    const tmpDir = tempDirWithFiles("junit-failure", {
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
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
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

    expect(assertion.failure[0].$.message).toContain("expect(received).toBe(expected)");
    expect(assertion.failure[0]._).toContain("Expected: 2");
    expect(assertion.failure[0]._).toContain("Received: 1");
    expect(assertion.failure[0]._).toContain("fail.test.js:5");

    // No ANSI escape sequences should leak into the report.
    expect(xmlContent).not.toContain("\x1b[");
    expect(exitCode).toBe(1);
  });
});

function filterJunitXmlOutput(xmlContent) {
  return xmlContent.replaceAll(/ (time|hostname)=".*?"/g, "");
}
