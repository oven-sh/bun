import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/5192
//
// When JSC (not Bun's own parser) rejects a module with a SyntaxError, the
// ErrorInstance carries line/sourceURL on its C++ fields but those were never
// surfaced because the error has no JS stack at module-parse time. The error
// printed as a bare "SyntaxError: ..." with no file, line, or code frame.

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("issue-5192", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// `with` in strict mode is caught by JSC's parser, not Bun's, so it exercises
// the JSC ParserError path directly.
const withInStrict = `"use strict";
export const x = 1;
function foo() {
  with ({ a: 1 }) {
    console.log(a);
  }
}
foo();
`;

test.concurrent("JSC parse SyntaxError in the entry module prints file and line", async () => {
  const { stderr, exitCode } = await run({ "entry.mjs": withInStrict }, "entry.mjs");
  expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
  // File path with a line number must appear somewhere in the output.
  expect(stderr).toMatch(/entry\.mjs:\d+/);
  // A code frame with the `with` line must appear.
  expect(stderr).toMatch(/\bwith\b.*\{ a: 1 \}/);
  expect(exitCode).toBe(1);
});

test.concurrent("JSC parse SyntaxError in an imported ESM module prints file and line", async () => {
  const { stderr, exitCode } = await run(
    {
      "module.mjs": withInStrict,
      "entry.ts": `import "./module.mjs";`,
    },
    "entry.ts",
  );
  expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
  expect(stderr).toMatch(/module\.mjs:\d+/);
  expect(stderr).toMatch(/\bwith\b.*\{ a: 1 \}/);
  expect(exitCode).toBe(1);
});

test.concurrent("JSC parse SyntaxError in an imported .ts module prints file and line", async () => {
  const { stderr, exitCode } = await run(
    {
      "module.ts": withInStrict,
      "entry.ts": `import "./module.ts";`,
    },
    "entry.ts",
  );
  expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
  expect(stderr).toMatch(/module\.ts:\d+/);
  expect(stderr).toMatch(/\bwith\b.*\{ a: 1 \}/);
  expect(exitCode).toBe(1);
});

test.concurrent("JSC parse SyntaxError: 'delete x' in strict mode prints file and line", async () => {
  const { stderr, exitCode } = await run(
    {
      "module.mjs": `export const x = 1;
function fn() {
  delete someVar;
}
fn();
`,
      "entry.mjs": `import "./module.mjs";`,
    },
    "entry.mjs",
  );
  expect(stderr).toContain("SyntaxError: Cannot delete unqualified property 'someVar' in strict mode.");
  expect(stderr).toMatch(/module\.mjs:\d+/);
  expect(exitCode).toBe(1);
});

test.concurrent("JSC parse SyntaxError from dynamic import() prints file and line when re-thrown", async () => {
  const { stderr, exitCode } = await run(
    {
      "module.mjs": withInStrict,
      "entry.mjs": `try {
  await import("./module.mjs");
} catch (e) {
  console.error(e);
}
`,
    },
    "entry.mjs",
  );
  expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
  expect(stderr).toMatch(/module\.mjs:\d+/);
  expect(exitCode).toBe(0);
});

test.concurrent("JSC parse SyntaxError in a require()'d CJS module prints the offending line", async () => {
  // require() has a JS stack so the `<parse>` frame comes from the .stack
  // formatter rather than the error printer's synthetic frame; both paths had
  // the same column-0 source-map lookup bug that resolved to the previous line.
  const { stderr, exitCode } = await run(
    {
      "mod.cjs": `"use strict";
with ({ a: 1 }) { console.log(a); }
`,
      "main.cjs": `require("./mod.cjs");`,
    },
    "main.cjs",
  );
  expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
  expect(stderr).toMatch(/mod\.cjs:2\b/);
  expect(stderr).toMatch(/2 \|.*\bwith\b/);
  expect(exitCode).toBe(1);
});

test.concurrent(
  "JSC parse SyntaxError reported line points at the offending statement, not the line before",
  async () => {
    // addErrorInfo() discards the parser-error column; a naive source-map lookup
    // at column 0 resolves to bun's own start-of-line mapping for the *previous*
    // source line when the offending statement is indented.
    const { stderr, exitCode } = await run(
      {
        "module.mjs": `export const x = 1;
function foo() {
  with ({ a: 1 }) {
    console.log(a);
  }
}
foo();
`,
      },
      "module.mjs",
    );
    expect(stderr).toContain("SyntaxError: 'with' statements are not valid in strict mode.");
    expect(stderr).toMatch(/module\.mjs:3\b/);
    expect(stderr).toMatch(/3 \|.*\bwith\b/);
    expect(exitCode).toBe(1);
  },
);
