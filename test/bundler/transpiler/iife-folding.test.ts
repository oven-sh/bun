import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("IIFE folding", () => {
  async function minify(code: string): Promise<string> {
    using dir = tempDir("iife-test", {
      "input.js": code,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "input.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(`Build failed: ${stderr}`);
    }

    return stdout.trim();
  }

  describe("arrow function IIFEs", () => {
    test("empty arrow IIFE to void 0", async () => {
      const code = await minify("export const x = (() => {})()");
      expect(code).toContain("void 0");
      expect(code).not.toContain("=>");
    });

    test("arrow expression IIFE inlined", async () => {
      const code = await minify("export const x = (() => 42)()");
      // Variable may be renamed, check the value is inlined
      expect(code).toMatch(/=\s*42/);
      expect(code).not.toContain("=>");
    });

    test("arrow expression with call inlined", async () => {
      const code = await minify("export const x = (() => foo())()");
      // Variable may be renamed, check the call is inlined
      expect(code).toMatch(/=\s*foo\(\)/);
      expect(code).not.toContain("=>");
    });

    test("arrow with return statement inlined", async () => {
      const code = await minify("export const x = (() => { return 42 })()");
      // Variable may be renamed, check the value is inlined
      expect(code).toMatch(/=\s*42/);
      expect(code).not.toContain("return");
    });

    test("arrow with return call inlined", async () => {
      const code = await minify("export const x = (() => { return foo() })()");
      // Variable may be renamed, check the call is inlined
      expect(code).toMatch(/=\s*foo\(\)/);
      expect(code).not.toContain("return");
    });

    test("arrow with expression statement becomes sequence", async () => {
      const code = await minify("export const x = (() => { sideEffect() })()");
      expect(code).toContain("sideEffect()");
      expect(code).toContain("void 0");
    });

    test("nested IIFE in call argument", async () => {
      const code = await minify("console.log((() => 42)())");
      expect(code).toContain("console.log(42)");
      expect(code).not.toContain("=>");
    });
  });

  describe("function expression IIFEs", () => {
    test("empty function IIFE to void 0", async () => {
      const code = await minify("export const x = (function() {})()");
      expect(code).toContain("void 0");
      expect(code).not.toContain("function");
    });
  });

  describe("edge cases - should NOT be folded", () => {
    test("async arrow NOT folded (returns Promise)", async () => {
      const code = await minify("export const x = (async () => { await foo() })()");
      expect(code).toContain("async");
    });

    test("arrow with arguments NOT folded", async () => {
      const code = await minify("export const x = ((a) => a + 1)(5)");
      expect(code).toContain("=>");
    });

    test("function with body NOT folded (this binding)", async () => {
      const code = await minify("export const x = (function() { return this.x })()");
      expect(code).toContain("function");
    });

    test("generator function NOT folded", async () => {
      const code = await minify("export const x = (function*() {})()");
      expect(code).toContain("function*");
    });

    test("async function NOT folded", async () => {
      const code = await minify("export const x = (async function() {})()");
      expect(code).toContain("async");
    });
  });
});
