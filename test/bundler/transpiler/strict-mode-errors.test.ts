import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Annex B constructs that are legal in sloppy mode but a SyntaxError in strict
// mode (and therefore in any ES module). Node, esbuild, and tsc all reject
// these; bun's parser previously accepted them silently because the
// corresponding `StrictModeFeature` variants were never wired up.

type Case = {
  name: string;
  body: string;
  errorSubstring: string;
};

const cases: Case[] = [
  {
    name: "legacy octal literal",
    body: "console.log(010);",
    errorSubstring: "Legacy octal literals cannot be used in strict mode",
  },
  {
    name: "legacy octal literal as property key",
    body: "var o = { 010: 1 }; console.log(o);",
    errorSubstring: "Legacy octal literals cannot be used in strict mode",
  },
  {
    name: "for-in var initializer",
    body: "for (var i = 0 in { a: 1 }) { console.log(i); }",
    errorSubstring: "Variable initializers within for-in loops cannot be used in strict mode",
  },
  {
    name: "function declaration in if body",
    body: "if (1) function f() {}",
    errorSubstring: "Function declarations inside if statements cannot be used in strict mode",
  },
  {
    name: "function declaration in else body",
    body: "if (0) ; else function f() {}",
    errorSubstring: "Function declarations inside if statements cannot be used in strict mode",
  },
  {
    name: "labeled function declaration",
    body: "lab: function g() {}",
    errorSubstring: "Function declarations inside labels cannot be used in strict mode",
  },
];

async function run(source: string, filename: string) {
  using dir = tempDir("strict-mode-errors", { [filename]: source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), filename],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("strict-mode early errors", () => {
  for (const c of cases) {
    describe(c.name, () => {
      test('is rejected after "use strict"', async () => {
        const { stderr, exitCode } = await run(`"use strict";\n${c.body}\n`, "entry.js");
        expect(stderr).toContain(c.errorSubstring);
        expect(exitCode).toBe(1);
      });

      test("is rejected in an ES module via export", async () => {
        const { stderr, exitCode } = await run(`${c.body}\nexport {};\n`, "entry.mjs");
        expect(stderr).toContain(c.errorSubstring);
        expect(exitCode).toBe(1);
      });

      test("is rejected inside a strict-mode function body", async () => {
        const { stderr, exitCode } = await run(`function outer() { "use strict";\n${c.body}\n} outer();\n`, "entry.js");
        expect(stderr).toContain(c.errorSubstring);
        expect(exitCode).toBe(1);
      });

      test("is rejected inside a class body", async () => {
        const { stderr, exitCode } = await run(`class C { m() { ${c.body} } } new C().m();\n`, "entry.js");
        expect(stderr).toContain(c.errorSubstring);
        expect(exitCode).toBe(1);
      });

      test("is allowed in sloppy mode", async () => {
        const { stderr, exitCode } = await run(`${c.body}\n`, "entry.cjs");
        expect(stderr).not.toContain("cannot be used in strict mode");
        expect(exitCode).toBe(0);
      });
    });
  }

  // The for-in var-initializer case is special: bun lowers it to a separate
  // assignment, so sloppy CJS code that uses it should keep running (and the
  // bundler can still emit it into ESM output without producing invalid code).
  test("for-in var initializer is lowered in sloppy mode", async () => {
    const { stdout, exitCode } = await run(
      `var keys = []; for (var i = 0 in { a: 1, b: 2 }) { keys.push(i); } console.log(keys.join(","));\n`,
      "entry.cjs",
    );
    expect(stdout.trim()).toBe("a,b");
    expect(exitCode).toBe(0);
  });

  test("legacy octal literal is allowed in a sloppy function inside a sloppy file", async () => {
    const { stdout, stderr, exitCode } = await run(`function f() { return 010; } console.log(f());\n`, "entry.cjs");
    expect(stderr).not.toContain("cannot be used in strict mode");
    expect(stdout.trim()).toBe("8");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("bundler strict-mode early errors", () => {
  for (const c of cases) {
    test(`${c.name} fails to bundle as ESM`, async () => {
      using dir = tempDir("strict-mode-bundle", {
        "entry.js": `${c.body}\nexport {};\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--format=esm", "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(c.errorSubstring);
      expect(exitCode).not.toBe(0);
    });
  }

  test("legacy octal literal error is emitted once under minify-syntax substitution", async () => {
    using dir = tempDir("strict-mode-bundle-minify", {
      "entry.js": `"use strict";\nfunction f() { let x = 010; return x + 1; }\nf();\nexport {};\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--format=esm", "--minify-syntax", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const count = (stderr.match(/Legacy octal literals cannot be used/g) || []).length;
    expect(count).toBe(1);
    expect(exitCode).not.toBe(0);
  });

  // Legacy octal literals, for-in var initializers, and function declarations
  // in if/label bodies are all lowered to valid strict-mode code when bundling
  // a sloppy CJS file into ESM, so they must not be rejected by the
  // `is_strict_mode_output_format()` fallback. This matches esbuild.
  test("sloppy CJS constructs are lowered (not rejected) when bundled to ESM", async () => {
    using dir = tempDir("strict-mode-bundle-cjs", {
      "entry.js": `import "./sloppy.cjs";\n`,
      "sloppy.cjs": [
        `for (var i = 0 in { a: 1 }) { console.log(i); }`,
        `if (1) function f() { return 1; }`,
        `lab: function g() {}`,
        `console.log(010);`,
        ``,
      ].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--format=esm", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("cannot be used");
    expect(stdout).not.toMatch(/for\s*\(\s*var\s+\w+\s*=/);
    expect(stdout).not.toMatch(/\b010\b/);
    expect(exitCode).toBe(0);
  });
});
