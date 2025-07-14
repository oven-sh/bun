import { expect, test } from "bun:test";
import { bunEnv, bunExe, readdirSorted, tempDirWithFiles } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import path from "path";
import { normalizeBunSnapshot } from "harness";

// Helper function to normalize HTML content for consistent snapshots
function normalizeHtmlContent(html: string, dir: string): string {
  return normalizeBunSnapshot(html, dir);
}

test("html coverage reporter - complete HTML output snapshot single file", async () => {
  const dir = tempDirWithFiles("html-cov-single", {
    "calculator.ts": `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}

export function complexOperation(x: number): number {
  if (x < 0) {
    return -1;
  } else if (x === 0) {
    return 0;
  } else if (x > 100) {
    return 100;
  }
  return x * 2;
}
`,
    "calculator.test.ts": `
import { add, subtract, multiply } from "./calculator";
import { expect, test } from "bun:test";

test("add function", () => {
  expect(add(2, 3)).toBe(5);
  expect(add(-1, 1)).toBe(0);
});

test("subtract function", () => {
  expect(subtract(5, 3)).toBe(2);
});

test("multiply function", () => {
  expect(multiply(4, 5)).toBe(20);
  expect(multiply(0, 5)).toBe(0);
});

// Note: divide and complexOperation are not tested, so they should show as uncovered
`,
    "bunfig.toml": `
[coverage]
coverageSkipTestFiles = true
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "html"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  expect(result.exitCode).toBe(0);

  // Find the HTML file for calculator.ts
  const coverageDir = path.join(dir, "coverage");
  const files = (await readdirSorted(coverageDir)).map(f => f.replaceAll("\\", "/"));
  const htmlFiles = files.filter(f => f.endsWith(".html"));
  const calculatorHtmlFile = files.find(f => f.includes("calculator.ts") && f.endsWith(".html"));

  // Verify file structure with inline snapshot
  expect({
    totalFiles: files.length,
    htmlFiles: htmlFiles.sort(),
    hasCalculatorFile: !!calculatorHtmlFile,
    hasIndexFile: files.includes("index.html"),
  }).toMatchInlineSnapshot(`
{
  "hasCalculatorFile": true,
  "hasIndexFile": true,
  "htmlFiles": [
    "calculator.test.ts.html",
    "calculator.ts.html",
    "index.html",
  ],
  "totalFiles": 3,
}
`);

  expect(calculatorHtmlFile).toBeDefined();

  const htmlContent = normalizeHtmlContent(readFileSync(path.join(coverageDir, calculatorHtmlFile!), "utf-8"), dir);

  expect(htmlContent).toMatchSnapshot("html-coverage-reporter-single-file");

  // Also capture the process output for verification
  const stdout = normalizeHtmlContent(result.stdout.toString("utf-8"), dir);
  const stderr = normalizeHtmlContent(result.stderr.toString("utf-8"), dir);

  expect({
    stdout,
    stderr,
    exitCode: result.exitCode,
    htmlFilesGenerated: files.filter(f => f.endsWith(".html")).length,
  }).toMatchSnapshot("html-coverage-reporter-single-file-process-output");
});

test("html coverage reporter - complete HTML output snapshot multiple files", async () => {
  const dir = tempDirWithFiles("html-cov-multi", {
    "src/math/operations.ts": `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function power(base: number, exponent: number): number {
  if (exponent === 0) {
    return 1;
  }
  if (exponent === 1) {
    return base;
  }
  return Math.pow(base, exponent);
}
`,
    "src/utils/string-utils.ts": `
export function capitalize(str: string): string {
  if (!str) {
    return "";
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function reverse(str: string): string {
  return str.split("").reverse().join("");
}

export function isPalindrome(str: string): boolean {
  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned === cleaned.split("").reverse().join("");
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + "...";
}
`,
    "src/validation/validators.ts": `
export function isEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}

export function isPhoneNumber(phone: string): boolean {
  const phoneRegex = /^\\+?[\\d\\s-()]+$/;
  return phoneRegex.test(phone) && phone.replace(/\\D/g, "").length >= 10;
}

export function isStrongPassword(password: string): boolean {
  if (password.length < 8) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return hasUpper && hasLower && hasNumber && hasSpecial;
}
`,
    "test/math.test.ts": `
import { add, multiply } from "../src/math/operations";
import { expect, test } from "bun:test";

test("add function", () => {
  expect(add(2, 3)).toBe(5);
  expect(add(0, 0)).toBe(0);
});

test("multiply function", () => {
  expect(multiply(4, 5)).toBe(20);
  expect(multiply(0, 10)).toBe(0);
});
`,
    "test/string-utils.test.ts": `
import { capitalize, reverse } from "../src/utils/string-utils";
import { expect, test } from "bun:test";

test("capitalize function", () => {
  expect(capitalize("hello")).toBe("Hello");
  expect(capitalize("")).toBe("");
});

test("reverse function", () => {
  expect(reverse("hello")).toBe("olleh");
  expect(reverse("a")).toBe("a");
});
`,
    "test/validation.test.ts": `
import { isEmail } from "../src/validation/validators";
import { expect, test } from "bun:test";

test("isEmail function", () => {
  expect(isEmail("test@example.com")).toBe(true);
  expect(isEmail("invalid-email")).toBe(false);
});
`,
    "bunfig.toml": `
[coverage]
coverageSkipTestFiles = true
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "html"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  expect(result.exitCode).toBe(0);

  const coverageDir = path.join(dir, "coverage");
  const files = (await readdirSorted(coverageDir)).map(f => f.replaceAll("\\", "/"));
  const htmlFiles = files.filter(f => f.endsWith(".html"));

  // Verify multiple files structure
  expect({
    totalFiles: files.length,
    htmlFiles: htmlFiles.sort(),
    hasIndexFile: files.includes("index.html"),
    hasSourceFiles:
      htmlFiles.some(f => f.includes("math_operations")) &&
      htmlFiles.some(f => f.includes("utils_string-utils")) &&
      htmlFiles.some(f => f.includes("validation_validators")),
    hasTestFiles: htmlFiles.some(f => f.includes("test")),
  }).toMatchInlineSnapshot(`
{
  "hasIndexFile": true,
  "hasSourceFiles": true,
  "hasTestFiles": true,
  "htmlFiles": [
    "index.html",
    "src_math_operations.ts.html",
    "src_utils_string-utils.ts.html",
    "src_validation_validators.ts.html",
    "test_math.test.ts.html",
    "test_string-utils.test.ts.html",
    "test_validation.test.ts.html",
  ],
  "totalFiles": 7,
}
`);

  // Should have HTML files for each source file
  expect(htmlFiles.length).toBeGreaterThanOrEqual(3);

  // Read all HTML files and create snapshots
  const htmlOutputs: Record<string, string> = {};
  for (const htmlFile of htmlFiles.sort()) {
    const content = readFileSync(path.join(coverageDir, htmlFile), "utf-8");
    htmlOutputs[htmlFile] = normalizeHtmlContent(content, dir);
  }

  // Verify some content with normalization before snapshotting
  const indexContent = htmlOutputs["index.html"];
  if (indexContent) {
    expect(indexContent).toMatchSnapshot("html-coverage-reporter-multiple-files-index");
  }

  // Keep original snapshot structure
  expect(htmlOutputs).toMatchSnapshot("html-coverage-reporter-multiple-files");

  // Capture process output
  const stdout = normalizeHtmlContent(result.stdout.toString("utf-8"), dir);
  const stderr = normalizeHtmlContent(result.stderr.toString("utf-8"), dir);

  expect({
    stdout,
    stderr,
    exitCode: result.exitCode,
    htmlFilesGenerated: htmlFiles.length,
    htmlFileNames: htmlFiles.sort(),
  }).toMatchSnapshot("html-coverage-reporter-multiple-files-process-output");
});

test("html coverage reporter - edge cases and special scenarios", async () => {
  const dir = tempDirWithFiles("html-cov-edge", {
    "src/empty.ts": `
// This file has no executable code
export {};
`,
    "src/single-line.ts": `export const value = 42;`,
    "src/complex-paths.ts": `
export function processPath(inputPath: string): string {
  if (!inputPath) {
    return "";
  }
  
  // This code path won't be covered
  if (inputPath.includes("../")) {
    throw new Error("Invalid path");
  }
  
  return inputPath.replace(/\\\\/g, "/");
}
`,
    "src/unicode-content.ts": `
export function greetInLanguages(name: string): string {
  const greetings = [
    \`Hello, \${name}! 🌍\`,
    \`Hola, \${name}! 🇪🇸\`,
    \`Bonjour, \${name}! 🇫🇷\`,
    \`Guten Tag, \${name}! 🇩🇪\`,
  ];
  
  // This will be uncovered
  if (name.length > 20) {
    return "Name too long";
  }
  
  return greetings[0];
}
`,
    "test/basic.test.ts": `
import { processPath } from "../src/complex-paths";
import { greetInLanguages } from "../src/unicode-content";
import { expect, test } from "bun:test";

test("processPath basic case", () => {
  expect(processPath("src/file.ts")).toBe("src/file.ts");
  expect(processPath("")).toBe("");
});

test("greetInLanguages basic case", () => {
  expect(greetInLanguages("World")).toContain("Hello, World!");
});
`,
    "bunfig.toml": `
[coverage]
coverageSkipTestFiles = true
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "html"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  expect(result.exitCode).toBe(0);

  const coverageDir = path.join(dir, "coverage");
  const files = (await readdirSorted(coverageDir)).map(f => f.replaceAll("\\", "/"));
  const htmlFiles = files.filter(f => f.endsWith(".html"));

  // Read all HTML files and create snapshots for edge cases
  const htmlOutputs: Record<string, string> = {};
  for (const htmlFile of htmlFiles.sort()) {
    const content = readFileSync(path.join(coverageDir, htmlFile), "utf-8");
    htmlOutputs[htmlFile] = normalizeHtmlContent(content, coverageDir);
  }

  // Verify some HTML content with normalization
  const firstHtmlFile = htmlFiles.find(f => f.includes("complex-paths"));
  if (firstHtmlFile) {
    const content = htmlOutputs[firstHtmlFile];
    expect(content).toMatchSnapshot("html-coverage-reporter-edge-cases-complex-paths");
  }

  // Keep original snapshot structure
  expect(htmlOutputs).toMatchSnapshot("html-coverage-reporter-edge-cases");

  // Verify specific edge case handling
  const complexPathsHtml = htmlFiles.find(f => f.includes("complex-paths"));
  if (complexPathsHtml) {
    const content = normalizeHtmlContent(readFileSync(path.join(coverageDir, complexPathsHtml), "utf-8"), dir);

    // Should contain uncovered lines in legend
    expect(content).toContain("Uncovered lines");
    expect(content).toContain("line-number");

    // Should have proper HTML structure
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain('<meta charset="UTF-8">');
    expect(content).toContain("src/complex-paths.ts");
  }

  // Capture process output for edge cases
  const stdout = normalizeHtmlContent(result.stdout.toString("utf-8"), dir);
  const stderr = normalizeHtmlContent(result.stderr.toString("utf-8"), dir);

  expect({
    stdout,
    stderr,
    exitCode: result.exitCode,
    htmlFilesGenerated: htmlFiles.length,
    htmlFileNames: htmlFiles.sort(),
  }).toMatchSnapshot("html-coverage-reporter-edge-cases-process-output");
});

test("html coverage reporter - combined with lcov reporter snapshot", async () => {
  const dir = tempDirWithFiles("html-lcov-combined", {
    "lib/calculator.ts": `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  subtract(a: number, b: number): number {
    return a - b;
  }
  
  multiply(a: number, b: number): number {
    if (a === 0 || b === 0) {
      return 0;
    }
    return a * b;
  }
  
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Division by zero");
    }
    return a / b;
  }
}
`,
    "test/calculator.test.ts": `
import { Calculator } from "../lib/calculator";
import { expect, test } from "bun:test";

test("calculator operations", () => {
  const calc = new Calculator();
  
  expect(calc.add(2, 3)).toBe(5);
  expect(calc.subtract(5, 3)).toBe(2);
  expect(calc.multiply(4, 0)).toBe(0);
  
  // divide method is not tested
});
`,
    "bunfig.toml": `
[coverage]
coverageSkipTestFiles = true
`,
  });

  const result = Bun.spawnSync(
    [bunExe(), "test", "--coverage", "--coverage-reporter", "html", "--coverage-reporter", "lcov"],
    {
      cwd: dir,
      env: {
        ...bunEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  expect(result.exitCode).toBe(0);

  const coverageDir = path.join(dir, "coverage");
  const files = (await readdirSorted(coverageDir)).map(f => f.replaceAll("\\", "/"));
  const htmlFiles = files.filter(f => f.endsWith(".html"));
  const lcovFiles = files.filter(f => f === "lcov.info");

  expect(htmlFiles.length).toBeGreaterThan(0);
  expect(lcovFiles.length).toBe(1);

  // Read HTML content
  const htmlContent = normalizeHtmlContent(readFileSync(path.join(coverageDir, htmlFiles[0]), "utf-8"), dir);

  // Read LCOV content
  const lcovContent = normalizeHtmlContent(readFileSync(path.join(coverageDir, "lcov.info"), "utf-8"), dir);

  // Verify HTML structure with normalization
  expect(normalizeHtmlContent(htmlContent, dir)).toContain("lib/calculator.ts");

  // Keep original snapshot structure
  expect({
    htmlContent,
    lcovContent,
  }).toMatchSnapshot("html-coverage-reporter-combined-with-lcov-reporter-html-content");

  // Capture process output
  const stdout = normalizeHtmlContent(result.stdout.toString("utf-8"), dir);
  const stderr = normalizeHtmlContent(result.stderr.toString("utf-8"), dir);

  console.log(dir);
  expect({
    stdout,
    stderr,
    exitCode: result.exitCode,
    htmlFilesGenerated: htmlFiles.length,
    lcovFilesGenerated: lcovFiles.length,
    allFiles: files.sort(),
  }).toMatchSnapshot("html-coverage-reporter-combined-with-lcov-reporter");
});
