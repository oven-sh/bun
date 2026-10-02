import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

  it("should report only the final result for a retried test", async () => {
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

  it.concurrent("includes the type, message and location of a build or resolve error in <failure>", async () => {
    await using tmpDir = tempDir("junit-build-error", {
      "package.json": "{}",
      "broken.js": "const x = ;\n",
      "load.test.js": `
        import { test } from "bun:test";
        test("syntax error", async () => { await import("./broken.js"); });
        test("missing module", async () => { await import("./does-not-exist.js"); });
      `,
    });

    const junitPath = join(tmpDir, "junit.xml");
    await using proc = spawn([bunExe(), "test", "--reporter=junit", "--reporter-outfile", junitPath], {
      cwd: tmpDir,
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 0 pass\n 2 fail\n");

    const xmlContent = await file(junitPath).text();
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
    });
    const [syntax, missing] = result.testsuites.testsuite[0].testcase;

    expect(syntax.failure).toEqual([
      {
        $: { type: "BuildMessage", message: "Unexpected ;" },
        _: "BuildMessage: Unexpected ;\n      at broken.js:1:11\n",
      },
    ]);
    expect(missing.failure[0].$.type).toBe("ResolveMessage");
    expect(missing.failure[0].$.message).toStartWith("Cannot find module './does-not-exist.js' from ");
    expect(missing.failure[0]._).toStartWith("ResolveMessage: Cannot find module './does-not-exist.js' from ");
    expect(exitCode).toBe(1);
  });

  describe.concurrent("a failure that is not a finished test", () => {
    it("is (load error) for a file that fails to load", async () => {
      await using dir = tempDir("junit-load-error", {
        "package.json": "{}",
        "a-good.test.js": `
          import { test, expect } from "bun:test";
          test("good", () => expect(1).toBe(1));
        `,
        "b-throw.test.js": `throw new Error("top-level-throw");`,
        "c-syntax.test.js": `const x = ;`,
        "d-import.test.js": `import "./does-not-exist.js";`,
      });

      const { stderr, exitCode, root, suites, xml } = await runJunit(dir);

      expect(suites).toEqual([
        { name: "a-good.test.js", tests: 1, failures: 0, cases: ["good"] },
        {
          name: "b-throw.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "Error", message: "top-level-throw" }],
        },
        {
          name: "c-syntax.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "BuildMessage", message: "Unexpected ;" }],
        },
        {
          name: "d-import.test.js",
          tests: 1,
          failures: 1,
          cases: [
            {
              name: "(load error)",
              type: "ResolveMessage",
              message: expect.stringContaining("Cannot find module './does-not-exist.js'"),
            },
          ],
        },
      ]);
      expect(root).toEqual({ tests: 4, failures: 3 });
      // The body of <failure> has the location, as for a failed test.
      expect(xml).toContain("at b-throw.test.js:1:");
      expect(xml).toContain("at c-syntax.test.js:1:11");
      // The console counts do not change.
      expect(stderr).toContain(" 1 pass\n 3 fail\n 3 errors\n");
      expect(exitCode).toBe(1);
    });

    it("is (describe callback) in the suite of the describe whose callback throws", async () => {
      await using dir = tempDir("junit-describe-callback", {
        "package.json": "{}",
        "m.test.js": `
          import { describe, expect, test } from "bun:test";
          describe("boom", () => {
            throw new Error("describe-body-throw");
          });
          describe("outer", () => {
            describe("inner", () => {
              throw new Error("nested-describe-throw");
            });
            test("in outer", () => expect(1).toBe(1));
          });
          test("beside", () => expect(1).toBe(1));
        `,
      });

      const { stderr, exitCode, root, suites } = await runJunit(dir);

      expect(suites).toEqual([
        {
          name: "m.test.js",
          tests: 4,
          failures: 2,
          cases: ["beside"],
          suites: [
            {
              name: "boom",
              line: 3,
              tests: 1,
              failures: 1,
              cases: [{ name: "(describe callback)", type: "Error", message: "describe-body-throw", line: 3 }],
            },
            {
              name: "outer",
              line: 6,
              tests: 2,
              failures: 1,
              cases: ["in outer"],
              suites: [
                {
                  name: "inner",
                  line: 7,
                  tests: 1,
                  failures: 1,
                  cases: [{ name: "(describe callback)", type: "Error", message: "nested-describe-throw", line: 7 }],
                },
              ],
            },
          ],
        },
      ]);
      expect(root).toEqual({ tests: 4, failures: 2 });
      expect(stderr).toContain(" 2 pass\n 0 fail\n 2 errors\n");
      expect(exitCode).toBe(1);
    });

    it("is (unhandled error) for an error that no running test owns", async () => {
      await using dir = tempDir("junit-unhandled-error", {
        "package.json": "{}",
        // The rejection is reported while the module waits. The module fails after
        // that, which is the load error of the file, and its tests do not run.
        "a-late.test.js": `
          import { test } from "bun:test";
          test("does not run", () => {});
          Promise.reject(new Error("floating-rejection"));
          await Bun.sleep(1);
          throw new Error("late-load-failure");
        `,
        // A rejection that a hook leaks belongs to no test. Its record is beside the test that
        // runs, so the suite of the describe block stays in one piece.
        "b-hook.test.js": `
          import { beforeEach, describe, expect, test } from "bun:test";
          describe("suite", () => {
            beforeEach(async () => {
              Promise.reject(new Error("leaked-by-beforeEach"));
              await Bun.sleep(1);
            });
            test("one", () => expect(1).toBe(1));
            test("two", () => expect(1).toBe(1));
          });
        `,
        // With two tests running, the error is not one test's failure. Its record is in the suite of the file.
        "c-concurrent.test.js": `
          import { describe, test } from "bun:test";
          describe("group", () => {
            test.concurrent("leaks", async () => {
              Promise.reject(new Error("leaked-in-group"));
              await Bun.sleep(1);
            });
            test.concurrent("waits", async () => {
              await Bun.sleep(1);
            });
          });
        `,
        // The callback of the describe block did not throw: the rejection is not its result.
        "d-stray.test.js": `
          import { describe, test } from "bun:test";
          describe("waits", async () => {
            Promise.reject(new Error("stray-while-describe-waits"));
            await Bun.sleep(1);
          });
          test("beside", () => {});
        `,
      });

      const { stderr, exitCode, root, suites } = await runJunit(dir);

      const unhandled = message => ({ name: "(unhandled error)", type: "Error", message });
      expect(suites).toEqual([
        {
          name: "a-late.test.js",
          tests: 2,
          failures: 2,
          cases: [
            unhandled("floating-rejection"),
            { name: "(load error)", type: "Error", message: "late-load-failure" },
          ],
        },
        {
          name: "b-hook.test.js",
          tests: 4,
          failures: 2,
          cases: [],
          suites: [
            {
              name: "suite",
              line: 3,
              tests: 4,
              failures: 2,
              cases: [unhandled("leaked-by-beforeEach"), "one", unhandled("leaked-by-beforeEach"), "two"],
            },
          ],
        },
        {
          name: "c-concurrent.test.js",
          tests: 3,
          failures: 1,
          cases: [unhandled("leaked-in-group")],
          suites: [{ name: "group", line: 3, tests: 2, failures: 0, cases: ["leaks", "waits"] }],
        },
        {
          name: "d-stray.test.js",
          tests: 2,
          failures: 1,
          cases: [unhandled("stray-while-describe-waits"), "beside"],
        },
      ]);
      expect(root).toEqual({ tests: 11, failures: 6 });
      expect(stderr).toContain(" 5 pass\n 1 fail\n 6 errors\n");
      expect(exitCode).toBe(1);
    });

    it("is in the report when every file fails to load", async () => {
      await using dir = tempDir("junit-all-fail", {
        "package.json": "{}",
        "a.test.js": `throw new Error("a-fails");`,
        "b.test.js": `const x = ;`,
        // A report of an earlier run must not survive this one.
        "junit.xml": "stale",
      });

      const { exitCode, root, suites } = await runJunit(dir);

      expect(suites).toEqual([
        {
          name: "a.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "Error", message: "a-fails" }],
        },
        {
          name: "b.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "BuildMessage", message: "Unexpected ;" }],
        },
      ]);
      expect(root).toEqual({ tests: 2, failures: 2 });
      expect(exitCode).toBe(1);
    });

    it("is in the report when --bail stops the run on it", async () => {
      await using dir = tempDir("junit-bail-load-error", {
        "package.json": "{}",
        "a.test.js": `
          import { test } from "bun:test";
          test("a", () => {});
        `,
        "b.test.js": `throw new Error("b-fails");`,
        "c.test.js": `
          import { test } from "bun:test";
          test("c", () => {});
        `,
      });

      const { stderr, exitCode, root, suites } = await runJunit(dir, ["--bail"]);

      expect(suites).toEqual([
        { name: "a.test.js", tests: 1, failures: 0, cases: ["a"] },
        {
          name: "b.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "Error", message: "b-fails" }],
        },
      ]);
      expect(root).toEqual({ tests: 2, failures: 1 });
      expect(stderr).toContain("Bailed out after 1 failure");
      expect(exitCode).toBe(1);
    });

    it("is in the report once for each run of --rerun-each", async () => {
      await using dir = tempDir("junit-rerun-each-errors", {
        "package.json": "{}",
        "a-describe.test.js": `
          import { describe, expect, test } from "bun:test";
          describe("boom", () => {
            throw new Error("describe-body-throw");
          });
          test("ok", () => expect(1).toBe(1));
        `,
        "b-load.test.js": `throw new Error("top-level-throw");`,
      });

      const { stderr, exitCode, root, suites } = await runJunit(dir, ["--rerun-each=2"]);

      const boom = {
        name: "boom",
        line: 3,
        tests: 1,
        failures: 1,
        cases: [{ name: "(describe callback)", type: "Error", message: "describe-body-throw", line: 3 }],
      };
      expect(suites).toEqual([
        { name: "a-describe.test.js", tests: 4, failures: 2, cases: ["ok", "ok"], suites: [boom, boom] },
        {
          name: "b-load.test.js",
          tests: 1,
          failures: 1,
          cases: [{ name: "(load error)", type: "Error", message: "top-level-throw" }],
        },
      ]);
      expect(root).toEqual({ tests: 5, failures: 3 });
      expect(stderr).toContain(" 2 pass\n 1 fail\n 3 errors\n");
      expect(exitCode).toBe(1);
    });

    it("is the load error of each file when --preload throws", async () => {
      await using dir = tempDir("junit-preload-throw", {
        "package.json": "{}",
        "preload.js": `throw new Error("preload-throw");`,
        "a.test.js": `
          import { test } from "bun:test";
          test("a", () => {});
        `,
        "b.test.js": `
          import { test } from "bun:test";
          test("b", () => {});
        `,
      });

      const { exitCode, root, suites } = await runJunit(dir, ["--preload", "./preload.js"]);

      const loadError = { name: "(load error)", type: "Error", message: "preload-throw" };
      expect(suites).toEqual([
        { name: "a.test.js", tests: 1, failures: 1, cases: [loadError] },
        { name: "b.test.js", tests: 1, failures: 1, cases: [loadError] },
      ]);
      expect(root).toEqual({ tests: 2, failures: 2 });
      expect(exitCode).toBe(1);
    });
  });
});

function filterJunitXmlOutput(xmlContent) {
  return xmlContent.replaceAll(/ (time|hostname)=".*?"/g, "");
}

// Runs `bun test --reporter=junit` in `dir` and reads the report back as one entry per file.
async function runJunit(dir, args = []) {
  const junitPath = join(String(dir), "junit.xml");
  await using proc = spawn([bunExe(), "test", ...args, "--reporter=junit", "--reporter-outfile", junitPath], {
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Every run here gets as far as its summary. If it does not, this shows why.
  expect(stderr).toMatch(/^Ran \d+ tests? across \d+ files?\./m);
  const xml = await file(junitPath).text();
  const { testsuites } = await new Promise((resolve, reject) => {
    xml2js.parseString(xml, { strict: true }, (err, r) => (err ? reject(err) : resolve(r)));
  });
  return {
    stderr,
    exitCode,
    xml,
    root: { tests: Number(testsuites.$.tests), failures: Number(testsuites.$.failures) },
    suites: (testsuites.testsuite ?? []).map(summarizeSuite),
  };
}

// A <testsuite> as its counts, its testcases (a name, or the name with the <failure> attributes) and its nested suites.
function summarizeSuite(suite) {
  return {
    name: suite.$.name,
    ...(suite.$.line && { line: Number(suite.$.line) }),
    tests: Number(suite.$.tests),
    failures: Number(suite.$.failures),
    cases: (suite.testcase ?? []).map(testcase =>
      testcase.failure
        ? {
            name: testcase.$.name,
            ...testcase.failure[0].$,
            ...(testcase.$.line && { line: Number(testcase.$.line) }),
          }
        : testcase.$.name,
    ),
    ...(suite.testsuite && { suites: suite.testsuite.map(summarizeSuite) }),
  };
}
