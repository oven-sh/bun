import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test(`"use strict'; preserves strict mode in CJS`, async () => {
  expect([path.join(import.meta.dir, "strict-mode-fixture.ts")]).toRun();
});

test(`sloppy mode by default in CJS`, async () => {
  expect([path.join(import.meta.dir, "sloppy-mode-fixture.ts")]).toRun();
});

describe("Annex B.3.3 block-level function hoisting in sloppy mode", () => {
  async function run(files: Record<string, string>, entry: string) {
    using dir = tempDir("annex-b-block-fn", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("hoists block-level functions to the enclosing var scope in CJS", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "z.cjs": `
{ function z() { return 9 } }
console.log(z());
if (true) function u() { return 1 }
console.log(typeof u);
if (true) { function w() { return 2 } }
console.log(typeof w);
function outer() {
  { function inner() { return "in" } }
  return inner();
}
console.log(outer());
`,
      },
      "z.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("9\nfunction\nfunction\nin\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("keeps block-level functions block-scoped in strict mode (ESM)", async () => {
    const { stdout, stderr, exitCode } = await run(
      { "z.mjs": `{ function z() { return 9 } }\nconsole.log(typeof z);\n` },
      "z.mjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("undefined\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("does not hoist past a conflicting lexical binding", async () => {
    const { stdout, stderr, exitCode } = await run(
      { "z.cjs": `let z = 1;\n{ function z() {} }\nconsole.log(typeof z);\n` },
      "z.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("number\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/23633
  test.concurrent("assigns the hoisted var when a block-level function shadows an outer one", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "foo.cjs": `
function foo() { console.log('foo') }
foo();
{
  function foo() { console.log('bar') }
  foo();
}
foo();
`,
      },
      "foo.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("foo\nbar\nbar\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/25737
  test.concurrent("hoists a labeled function declaration to the enclosing var scope", async () => {
    for (const [entry, expected] of [
      ["top.js", "bar\n"],
      ["nested.js", "ok\n"],
    ] as const) {
      const { stdout, stderr, exitCode } = await run(
        {
          "package.json": `{"type":"commonjs"}`,
          "top.js": `foo:\n    function bar() { return "bar"; }\nconsole.log(bar());\n`,
          "nested.js": `
function lex() {
  loop: function _lex() { return "ok"; }
  return _lex();
}
console.log(lex());
`,
        },
        entry,
      );
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("emits a labeled function declaration without a wrapping block", () => {
    // JSC and V8 disagree on whether `typeof bar` is "function" before the label
    // executes (V8: yes, JSC: no), so the runtime behaviour above only checks
    // post-label access. The transpiler still prints the source shape verbatim
    // so downstream tools that evaluate the output under V8 see B.3.2 timing.
    const out = new Bun.Transpiler({ loader: "js" }).transformSync(
      `foo: function bar() {}\nmodule.exports = bar;\n`,
    );
    expect(out).toMatch(/foo:\s*function bar\(\)/);
    expect(out).not.toMatch(/foo:\s*{/);
  });
});
