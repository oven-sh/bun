import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Runs the real vitest CLI (and its @vitest/coverage-v8 provider) under Bun.
// The coverage provider drives node:inspector's Profiler.startPreciseCoverage /
// takePreciseCoverage, so this covers the end-to-end integration rather than
// just the protocol surface.
const testRoot = join(import.meta.dirname, "..", "..", "..");
const testNodeModules = join(testRoot, "node_modules");
const testPackageJson = JSON.parse(readFileSync(join(testRoot, "package.json"), "utf8"));
const expectedVitestVersion = testPackageJson.dependencies?.vitest ?? testPackageJson.devDependencies?.vitest;

// Fail fast with a clear remedy if test/node_modules was populated from an
// older lockfile; reaching the network from a test would violate hermeticity.
function ensureVitestInstalled() {
  const vitestPackageJson = join(testNodeModules, "vitest", "package.json");
  const coverageV8 = join(testNodeModules, "@vitest", "coverage-v8", "package.json");
  const installed = existsSync(vitestPackageJson)
    ? JSON.parse(readFileSync(vitestPackageJson, "utf8")).version
    : undefined;
  if (installed === expectedVitestVersion && existsSync(coverageV8)) return;
  throw new Error(
    `test/node_modules has vitest ${installed ?? "<missing>"} but test/package.json requires ${expectedVitestVersion}. ` +
      `Run 'bun install' in test/ before running this test.`,
  );
}
ensureVitestInstalled();

const mathSource = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
  "export function classify(n: number): string {",
  "  if (n < 0) {",
  '    return "negative";',
  "  } else if (n === 0) {",
  '    return "zero";',
  "  }",
  '  return "positive";',
  "}",
  "",
  "export function neverCalled(x: number): number {",
  "  for (let i = 0; i < 10; i++) {",
  "    x += i;",
  "  }",
  "  return x;",
  "}",
  "",
].join("\n");

const mathTest = [
  'import { describe, expect, it } from "vitest";',
  'import { add, classify } from "../src/math";',
  "",
  'describe("math", () => {',
  '  it("adds", () => {',
  "    expect(add(1, 2)).toBe(3);",
  "  });",
  '  it("classifies", () => {',
  '    expect(classify(5)).toBe("positive");',
  '    expect(classify(0)).toBe("zero");',
  "  });",
  "});",
  "",
].join("\n");

const vitestConfig = [
  'import { defineConfig } from "vitest/config";',
  "",
  "export default defineConfig({",
  "  test: {",
  "    coverage: {",
  '      provider: "v8",',
  '      reporter: ["text"],',
  '      include: ["src/**"],',
  "    },",
  "  },",
  "});",
  "",
].join("\n");

// vitest resolves itself, its plugins, and the project's "vitest" import
// through node_modules, so link the packages installed in test/node_modules
// into the temporary project.
function createVitestProject() {
  const dir = tempDir("vitest-project", {
    "package.json": JSON.stringify({ name: "vitest-fixture", private: true, type: "module" }),
    "vitest.config.ts": vitestConfig,
    "src/math.ts": mathSource,
    "test/math.test.ts": mathTest,
  });
  mkdirSync(join(String(dir), "node_modules", "@vitest"), { recursive: true });
  symlinkSync(join(testNodeModules, "vitest"), join(String(dir), "node_modules", "vitest"), "junction");
  symlinkSync(
    join(testNodeModules, "@vitest", "coverage-v8"),
    join(String(dir), "node_modules", "@vitest", "coverage-v8"),
    "junction",
  );
  return dir;
}

async function runVitest(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "node_modules", "vitest", "vitest.mjs"), "--run", ...args],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("vitest", () => {
  test("runs a test suite", async () => {
    using dir = createVitestProject();
    const { stdout, stderr, exitCode } = await runVitest(String(dir), []);

    // Combined first assertion so a crashed/erroring vitest run shows its
    // stderr and exit code in the failure diff, not just an empty stdout.
    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr, stdout }).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: expect.stringMatching(/Test Files\s+1 passed/),
    });
    expect(stdout).toMatch(/Tests\s+2 passed/);
  }, 90_000);

  test("reports v8 coverage through node:inspector's precise coverage", async () => {
    using dir = createVitestProject();
    const { stdout, stderr, exitCode } = await runVitest(String(dir), ["--coverage"]);

    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr, stdout }).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: expect.stringMatching(/Tests\s+2 passed/),
    });
    // The same project produces this exact report under Node.js: add() and
    // classify() are covered, the negative branch and neverCalled() are not.
    expect(stdout).toMatch(/math\.ts\s*\|\s*50\s*\|\s*75\s*\|\s*66\.66\s*\|\s*55\.55\s*\|\s*7,15-18/);
  }, 120_000);

  // vitest runs a module of the project with vm.runInThisContext(code, { filename }), and a require() from another
  // module of the project loads the same file natively. A frame of the first is a position in vitest's code, and Bun
  // has a source map for what it loaded under that name.
  test("reports the line of a module that is also loaded with require()", async () => {
    const price = [
      '"use strict";',
      "",
      "const TAX = 0.2;",
      "",
      "/** Adds tax to a net price. */",
      "function withTax(net) {",
      "  // reject bad input",
      '  if (typeof net !== "number" || Number.isNaN(net)) {',
      '    throw new TypeError("net must be a number, got " + typeof net);',
      "  }",
      "",
      "  return net * (1 + TAX);",
      "}",
      "",
      "/** Sums a list of net prices, tax included. */",
      "function total(items) {",
      "  let sum = 0;",
      "",
      "  for (const item of items) {",
      "    sum += withTax(item);",
      "  }",
      "",
      "  return sum;",
      "}",
      "",
      "module.exports = { withTax, total };",
      "",
    ].join("\n");
    using dir = tempDir("vitest-line", {
      "package.json": JSON.stringify({ name: "vitest-fixture", private: true, type: "module" }),
      "src/price.cjs": price,
      "src/index.cjs": [
        '"use strict";',
        'const { total } = require("./price.cjs");',
        "module.exports = { checkout: cart => ({ total: total(cart.items) }) };",
        "",
      ].join("\n"),
      "test/app.test.ts": [
        'import { test, expect } from "vitest";',
        'import { checkout } from "../src/index.cjs";',
        'import { withTax } from "../src/price.cjs";',
        "",
        'test("checkout", () => {',
        "  expect(checkout({ items: [10] }).total).toBe(12);",
        "});",
        "",
        'test("withTax rejects a string", () => {',
        '  expect(withTax("12")).toBe(14.4);',
        "});",
        "",
      ].join("\n"),
    });
    mkdirSync(join(String(dir), "node_modules"), { recursive: true });
    symlinkSync(join(testNodeModules, "vitest"), join(String(dir), "node_modules", "vitest"), "junction");
    const { stdout, stderr, exitCode } = await runVitest(String(dir), []);
    const frame = (stdout + stderr).split("\n").find(line => line.includes("src/price.cjs"));
    expect(frame?.trim()).toBe("❯ withTax src/price.cjs:9:11");
    expect(exitCode).toBe(1);
  }, 90_000);
});
