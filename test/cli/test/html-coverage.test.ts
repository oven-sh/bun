import { describe, expect, it } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("HTML coverage reporter", () => {
  it("should generate an HTML coverage report", async () => {
    const dir = tempDirWithFiles("html-coverage-test", {
      "demo.ts": `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function uncoveredFunction(): string {
  return "this function is not covered";
}
      `,
      "demo.test.ts": `
import { test, expect } from "bun:test";
import { add, subtract } from "./demo";

test("add function", () => {
  expect(add(2, 3)).toBe(5);
});

test("subtract function", () => {
  expect(subtract(5, 3)).toBe(2);
});
      `,
    });

    const result = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter", "html", "./demo.test.ts"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);

    expect(exitCode).toBe(0);

    // Check that the HTML file was created
    const htmlPath = join(dir, "coverage", "index.html");
    expect(existsSync(htmlPath)).toBe(true);

    // Check the HTML content
    const htmlContent = readFileSync(htmlPath, "utf-8");
    
    // Should contain basic HTML structure
    expect(htmlContent).toContain("<!DOCTYPE html>");
    expect(htmlContent).toContain("<title>Bun Coverage Report</title>");
    expect(htmlContent).toContain("<h1>Bun Coverage Report</h1>");
    
    // Should contain the demo.ts file
    expect(htmlContent).toContain("demo.ts");
    
    // Should contain coverage information
    expect(htmlContent).toContain("Functions");
    expect(htmlContent).toContain("Lines");
    expect(htmlContent).toContain("Uncovered Lines");

    // Should have CSS styling
    expect(htmlContent).toContain(".coverage");
    expect(htmlContent).toContain("font-family");
  });

  it("should generate HTML coverage alongside other reporters", async () => {
    const dir = tempDirWithFiles("html-multiple-reporters", {
      "lib.ts": `
export function multiply(a: number, b: number): number {
  return a * b;
}
      `,
      "lib.test.ts": `
import { test, expect } from "bun:test";
import { multiply } from "./lib";

test("multiply function", () => {
  expect(multiply(3, 4)).toBe(12);
});
      `,
    });

    const result = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter", "text", "--coverage-reporter", "html", "--coverage-reporter", "lcov", "./lib.test.ts"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);

    expect(exitCode).toBe(0);

    // Check that all coverage files were created
    expect(existsSync(join(dir, "coverage", "index.html"))).toBe(true);
    expect(existsSync(join(dir, "coverage", "lcov.info"))).toBe(true);
    
    // Check text output contains coverage table
    expect(stderr).toContain("lib.ts");
    expect(stderr).toContain("% Funcs");
    expect(stderr).toContain("% Lines");
  });
});