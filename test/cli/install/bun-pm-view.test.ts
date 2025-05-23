import { spawn } from "bun";
import { expect, it, describe } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe("bun pm view", () => {
  async function setupTest() {
    const testDir = tmpdirSync();
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
      }),
    );
    return testDir;
  }

  async function runCommand(cmd: string[], testDir: string, expectSuccess = true) {
    const { stdout, stderr, exited } = spawn({
      cmd,
      cwd: testDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });

    const [output, error, exitCode] = await Promise.all([
      new Response(stdout).text(),
      new Response(stderr).text(),
      exited,
    ]);

    return { output, error, code: exitCode };
  }

  it("should display package info for latest version", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("is-number@");
    expect(output).toContain("Returns true if a number"); // Part of the package description
    expect(output).toContain("maintainers:");
  });

  it("should display package info for specific version", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@7.0.0"], testDir);
    expect(code).toBe(0);
    expect(output).toMatchInlineSnapshot(`
      "is-number@7.0.0 | MIT | deps: 0 | versions: 15
      Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.
      https://github.com/jonschlinkert/is-number
      keywords: cast, check, coerce, coercion, finite, integer, is, isnan, is-nan, is-num, is-number, isnumber, isfinite, istype, kind, math, nan, num, number, numeric, parseFloat, parseInt, test, type, typeof, value

      maintainers:
      - doowb <brian.woodward@gmail.com>
      - jonschlinkert <github@sellside.com>
      - realityking <me@rouvenwessling.de>

      dist-tags:
      latest: 7.0.0

      Published: 2018-07-04T15:08:58.238Z
      "
    `);
  });

  it("should display specific property", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@types/bun", "name"], testDir);

    expect(error).toBe("");
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toMatchInlineSnapshot(`
      "@types/bun
      "
    `);
    expect(code).toBe(0);
  });

  it("should display nested property", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number", "repository.url"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output.trim()).toContain("https://");
  });

  // TODO: JSON output needs to be fixed to show specific version data, not full registry manifest
  it("should output JSON format with --json flag", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@7.0.0", "--json"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");

    // Parse the JSON to verify it's valid
    const json = JSON.parse(output);
    expect(json).toMatchObject({
      name: "is-number",
      version: "7.0.0",
      description:
        "Returns true if a number or string value is a finite number. Useful for regex matches, parsing, user input, etc.",
      license: "MIT",
      homepage: "https://github.com/jonschlinkert/is-number",
      author: {
        name: "Jon Schlinkert",
        url: "https://github.com/jonschlinkert",
      },
      repository: {
        type: "git",
        url: expect.stringContaining("github.com/jonschlinkert/is-number"),
      },
      main: "index.js",
      engines: {
        node: ">=0.12.0",
      },
    });
  });

  it("should handle non-existent package", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand(
      [bunExe(), "pm", "view", "nonexistent-package-12345"],
      testDir,
      false,
    );

    expect(code).toBe(1);
    expect(error).toContain("Not Found");
    expect(output).toBe("");
  });

  // TODO: Version validation needs to be fixed - currently falls back to first version instead of failing
  it("should handle non-existent version", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@999.0.0"], testDir, false);

    expect(error).toMatchInlineSnapshot(`
      "error: No version of "is-number" satisfying "999.0.0" found

      Recent versions:
      - 4.0.0
      - 5.0.0
      - 6.0.0
      - 7.0.0
      - 7.0.0
        ... and 11 more
      "
    `);
    expect(code).toBe(1);
  });

  it("should handle non-existent property", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand(
      [bunExe(), "pm", "view", "is-number", "nonexistent"],
      testDir,
      false,
    );

    expect(error).toMatchInlineSnapshot(`
      "error: Property nonexistent not found
      "
    `);
    expect(code).toBe(1);
  });

  it("should handle malformed package specifier", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@"], testDir, false);

    expect(code).toBe(1);
    expect(error).toContain("Method Not Allowed");
    expect(output).toBe("");
  });

  it("should handle scoped packages", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "@types/node"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("@types/node@");
    expect(output).toContain("TypeScript definitions");
  });

  it("should handle missing arguments", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view"], testDir, false);

    expect(code).toBe(1);
    expect(error).toContain("missing package specifier");
    expect(output).toBe("");
  });

  it("should handle version ranges", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@^7.0.0"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("is-number@7.");
    expect(output).toContain("Returns true if a number");
  });

  it("should handle dist-tags like beta", async () => {
    const testDir = await setupTest();
    const { output, error, code } = await runCommand([bunExe(), "pm", "view", "is-number@latest"], testDir);

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("is-number@7.0.0"); // latest should resolve to 7.0.0
    expect(output).toContain("Returns true if a number");
  });
});
