import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

const xml2js = require("xml2js");

describe("junit reporter", () => {
  for (let withCIEnvironmentVariables of [false, true]) {
    it(`should generate valid junit xml for passing tests ${withCIEnvironmentVariables ? "with CI environment variables" : ""}`, async () => {
      const tmpDir = tempDirWithFiles("junit", {
        "package.json": "{}",
        "passing.test.js": `

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
      `,

        "test-2.test.js": `

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
        stdout: "inherit",
        "stderr": "inherit",
      });
      await proc.exited;
      console.log(junitPath);

      expect(proc.exitCode).toBe(1);
      const xmlContent = await file(junitPath).text();

      // Parse XML to verify structure
      const result = await new Promise((resolve, reject) => {
        xml2js.parseString(xmlContent, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      /**
     * ------ Vitest ------
     * <?xml version="1.0" encoding="UTF-8" ?>
     * <testsuites name="vitest tests" tests="11" failures="4" errors="0" time="0.176">
     *     <testsuite name="passing.test.js" timestamp="2024-11-18T09:21:11.933Z" hostname="Jarreds-MacBook-Pro.local" tests="7" failures="2" errors="0" skipped="2" time="0.005116208">
     *         <testcase classname="passing.test.js" name="should pass" time="0.000657541">
     *         </testcase>
     *         <testcase classname="passing.test.js" name="second test" time="0.000071875">
     *         </testcase>
     *         <testcase classname="passing.test.js" name="failing test" time="0.003308209">
     *             <failure message="expected 2 to be 3 // Object.is equality" type="AssertionError">
     * AssertionError: expected 2 to be 3 // Object.is equality
     * 
     * - Expected
     * + Received
     * 
     * - 3
     * + 2
     * 
     * ❯ passing.test.js:12:25
     *             </failure>
     *         </testcase>
        <testcase classname="passing.test.js" name="skipped test" time="0">
     *             <skipped/>
     *         </testcase>
     *         <testcase classname="passing.test.js" name="todo test" time="0">
     *             <skipped/>
     *         </testcase>
     *          <testcase classname="passing.test.js" name="nested describe &gt; should pass inside nested describe" time="0.000130042">
     *         </testcase>
     *         <testcase classname="passing.test.js" name="nested describe &gt; should fail inside nested describe" time="0.000403125">
     *             <failure message="expected 2 to be 3 // Object.is equality" type="AssertionError">
     * AssertionError: expected 2 to be 3 // Object.is equality
     * 
     * - Expected
     * + Received
     * 
     * - 3
     * + 2
     * 
     * ❯ passing.test.js:27:27
     *             </failure>
     *         </testcase>
    </testsuite>
     *     <testsuite name="test-2.test.js" timestamp="2024-11-18T09:21:11.936Z" hostname="Jarreds-MacBook-Pro.local" tests="4" failures="2" errors="0" skipped="0" time="0.005188916">
     *         <testcase classname="test-2.test.js" name="should pass" time="0.000642541">
     *         </testcase>
     *         <testcase classname="test-2.test.js" name="failing test" time="0.003380708">
     *             <failure message="expected 2 to be 3 // Object.is equality" type="AssertionError">
     * AssertionError: expected 2 to be 3 // Object.is equality
     * 
     * - Expected
     * + Received
     * 
     * - 3
     * + 2
     * 
     * ❯ test-2.test.js:8:25
     *             </failure>
     *         </testcase>
     *         <testcase classname="test-2.test.js" name="nested describe &gt; should pass inside nested describe" time="0.000140541">
     *         </testcase>
     *         <testcase classname="test-2.test.js" name="nested describe &gt; should fail inside nested describe" time="0.000306">
     *             <failure message="expected 2 to be 3 // Object.is equality" type="AssertionError">
     * AssertionError: expected 2 to be 3 // Object.is equality
     * 
     * - Expected
     * + Received
     * 
     * - 3
     * + 2
     * 
     * ❯ test-2.test.js:17:27
     *             </failure>
     *         </testcase>
     *     </testsuite>
     * </testsuites>
     */

      expect(result.testsuites).toBeDefined();
      expect(result.testsuites.testsuite).toBeDefined();

      let firstSuite = result.testsuites.testsuite[0];
      let secondSuite = result.testsuites.testsuite[1];

      if (firstSuite.$.name === "passing.test.js") {
        [firstSuite, secondSuite] = [secondSuite, firstSuite];
      }

      expect(firstSuite.testcase).toHaveLength(4);
      expect(firstSuite.testcase[0].$.name).toBe("should pass inside nested describe");
      expect(firstSuite.$.name).toBe("test-2.test.js");
      expect(firstSuite.$.tests).toBe("4");
      expect(firstSuite.$.failures).toBe("2");
      expect(firstSuite.$.skipped).toBe("0");
      expect(parseFloat(firstSuite.$.time)).toBeGreaterThanOrEqual(0.0);

      expect(secondSuite.testcase).toHaveLength(7);
      expect(secondSuite.testcase[0].$.name).toBe("should pass inside nested describe");
      expect(secondSuite.$.name).toBe("passing.test.js");
      expect(secondSuite.$.tests).toBe("7");
      expect(secondSuite.$.failures).toBe("2");
      expect(secondSuite.$.skipped).toBe("2");
      expect(parseFloat(secondSuite.$.time)).toBeGreaterThanOrEqual(0.0);

      expect(result.testsuites.$.tests).toBe("11");
      expect(result.testsuites.$.failures).toBe("4");
      expect(result.testsuites.$.skipped).toBe("2");
      expect(parseFloat(result.testsuites.$.time)).toBeGreaterThanOrEqual(0.0);

      if (withCIEnvironmentVariables) {
        // "properties": [
        //   {
        //     "property": [
        //       {
        //         "$": {
        //           "name": "ci",
        //           "value": "https://ci.example.com/123"
        //         }
        //       },
        //       {
        //         "$": {
        //           "name": "commit",
        //           "value": "1234567890"
        //         }
        //       }
        //     ]
        //   }
        // ],
        expect(firstSuite.properties).toHaveLength(1);
        expect(firstSuite.properties[0].property).toHaveLength(2);
        expect(firstSuite.properties[0].property[0].$.name).toBe("ci");
        expect(firstSuite.properties[0].property[0].$.value).toBe("https://ci.example.com/123");
        expect(firstSuite.properties[0].property[1].$.name).toBe("commit");
        expect(firstSuite.properties[0].property[1].$.value).toBe("1234567890");
      }
    });
  }
});
