import { it, describe, expect } from "bun:test";
import { file, write } from "bun:fs";
import { tempDirWithFiles } from "../harness";

const xml2js = require("xml2js");

describe("junit reporter", () => {
  it("should generate valid junit xml for passing tests", async () => {
    const tmpDir = await tempDirWithFiles({
      "passing.test.js": `
        import { expect, it } from "bun:test";
        it("should pass", () => {
          expect(1 + 1).toBe(2);
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    const proc = Bun.spawn(["bun", "test", "--junit-report", junitPath], {
      cwd: tmpDir,
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const xmlContent = await file(junitPath).text();

    // Parse XML to verify structure
    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result.testsuites.testsuite).toBeDefined();
    const suite = result.testsuites.testsuite[0];
    expect(suite.$.tests).toBe("1");
    expect(suite.$.failures).toBe("0");
    expect(suite.$.skipped).toBe("0");
    expect(suite.testcase).toHaveLength(1);
    expect(suite.testcase[0].$.name).toBe("should pass");
  });

  it("should report failures correctly", async () => {
    const tmpDir = await tempDirWithFiles({
      "failing.test.js": `
        import { expect, it } from "bun:test";
        it("should fail", () => {
          expect(1 + 1).toBe(3);
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    const proc = Bun.spawn(["bun", "test", "--junit-report", junitPath], {
      cwd: tmpDir,
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

    expect(result.testsuites.testsuite).toBeDefined();
    const suite = result.testsuites.testsuite[0];
    expect(suite.$.failures).toBe("1");
    expect(suite.testcase[0].failure).toBeDefined();
  });

  it("should handle skipped tests", async () => {
    const tmpDir = await tempDirWithFiles({
      "skipped.test.js": `
        import { expect, it } from "bun:test";
        it.skip("skipped test", () => {
          expect(1 + 1).toBe(2);
        });
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    const proc = Bun.spawn(["bun", "test", "--junit-report", junitPath], {
      cwd: tmpDir,
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const xmlContent = await file(junitPath).text();

    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result.testsuites.testsuite).toBeDefined();
    const suite = result.testsuites.testsuite[0];
    expect(suite.$.skipped).toBe("1");
    expect(suite.testcase[0].skipped).toBeDefined();
  });

  it("should handle todo tests", async () => {
    const tmpDir = await tempDirWithFiles({
      "todo.test.js": `
        import { expect, it } from "bun:test";
        it.todo("todo test");
      `,
    });

    const junitPath = `${tmpDir}/junit.xml`;
    const proc = Bun.spawn(["bun", "test", "--junit-report", junitPath], {
      cwd: tmpDir,
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const xmlContent = await file(junitPath).text();

    const result = await new Promise((resolve, reject) => {
      xml2js.parseString(xmlContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result.testsuites.testsuite).toBeDefined();
    const suite = result.testsuites.testsuite[0];
    expect(suite.$.skipped).toBe("1");
    expect(suite.testcase[0].skipped[0].$.message).toBe("TODO");
  });
});
