import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test(`"use strict'; preserves strict mode in CJS`, async () => {
  expect([path.join(import.meta.dir, "strict-mode-fixture.ts")]).toRun();
});

test(`sloppy mode by default in CJS`, async () => {
  expect([path.join(import.meta.dir, "sloppy-mode-fixture.ts")]).toRun();
});

// https://github.com/oven-sh/bun/issues/31806
test(`function-level "use strict" is honored in CJS`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-cjs-fixture.cjs")]).toRun();
});

test(`function-level "use strict" survives require() of a CJS module`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-require-entry-fixture.cjs")]).toRun();
});

// Preserving the function-body directive also enables the ES 15.2.1 early error:
// a "use strict" directive in a function with a non-simple parameter list is a
// SyntaxError (matches Node). https://github.com/oven-sh/bun/issues/18333
const source = `function test(a = 5) { "use strict"; console.log(a); }\ntest(2);\n`;
for (const ext of ["cjs", "js", "mjs"]) {
  test.concurrent(`"use strict" with a non-simple parameter list is a SyntaxError (.${ext})`, async () => {
    using dir = tempDir(`issue-18333-${ext}`, { [`index.${ext}`]: source });

    await using proc = Bun.spawn({
      cmd: [bunExe(), `index.${ext}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("use strict");
    expect(stderr).toContain("non-simple parameter list");
    expect(exitCode).not.toBe(0);
  });
}

// A Use Strict Directive must contain no escape sequence (ECMA-262). An escaped
// form like "use\x20strict" or "\u0075se strict" is an ordinary string literal,
// not a directive, so it must NOT enable strict mode and must NOT trip the
// non-simple-parameter early error (matches Node).
test.concurrent(`escaped "use strict" is not a directive (runs sloppy, no early error)`, async () => {
  using dir = tempDir("issue-31806-escaped", {
    "index.cjs": String.raw`
      // Escaped space — cooks to "use strict" but is not a directive.
      const hexEscaped = (function () {
        "use\x20strict";
        return this === undefined;
      })();
      // Escaped "u" — same idea with a unicode escape.
      const unicodeEscaped = (function () {
        "\u0075se strict";
        return this === undefined;
      })();
      // A non-simple parameter list with an escaped directive must NOT be a SyntaxError.
      function withDefault(a = 1) {
        "use\x20strict";
        return a;
      }
      console.log(JSON.stringify({ hexEscaped, unicodeEscaped, withDefault: withDefault() }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Both escaped IIFEs run sloppy, so `this` is the global (not undefined).
  expect(JSON.parse(stdout.trim())).toEqual({
    hexEscaped: false,
    unicodeEscaped: false,
    withDefault: 1,
  });
  expect(exitCode).toBe(0);
});

// A Directive Prologue entry must be a bare StringLiteral token (ECMA-262). A
// parenthesized string ends the prologue, so a following "use strict" is an
// ordinary statement — it must not enable strict mode or trip the
// non-simple-parameter early error (matches Node).
test.concurrent(`a parenthesized string ends the directive prologue`, async () => {
  using dir = tempDir("issue-31806-paren", {
    "index.cjs": String.raw`
      function withDefault(a = 1) {
        ("foo");
        "use strict";
        return this === undefined ? "strict" : "sloppy";
      }
      console.log(withDefault(2));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("sloppy");
  expect(exitCode).toBe(0);
});

// A brace block has no Directive Prologue (ECMA-262), so `{ "use strict"; }` at
// the top of a function body is an ordinary no-op string statement, not a
// directive. It must be dropped at parse time so `minify` cannot hoist a bare
// "use strict" out of the unwrapped single-statement block and make the engine
// treat the body as strict (or reject a non-simple parameter list). Matches Node.
test.concurrent(`a block-scope "use strict" is not a directive, even when minified`, async () => {
  // The bundled output is an ES module (implicitly strict), so runtime `this`
  // cannot distinguish the regression. Detect it two other ways: the dropped
  // string must not appear in the minified output at all, and the non-simple
  // parameter list makes a hoisted prologue directive a SyntaxError (ES 15.2.1)
  // when the output is executed.
  using dir = tempDir("issue-31806-block", {
    "entry.cjs": String.raw`
      function f(a = 1) {
        { "use strict"; }
        return a;
      }
      console.log(f(2));
    `,
  });

  // The regression only manifested under minify (single-statement block unwrap),
  // so bundle with minify and run the output.
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--minify-syntax", "--target=bun", "entry.cjs", "--outfile=out.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildStdout, buildStderr, buildExit] = await Promise.all([
    build.stdout.text(),
    build.stderr.text(),
    build.exited,
  ]);
  expect(buildStdout).toContain("out.js");
  expect(buildStderr).toBe("");
  expect(buildExit).toBe(0);

  const outJs = await Bun.file(`${dir}/out.js`).text();
  expect(outJs).not.toContain("use strict");

  await using run = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("2");
  expect(exitCode).toBe(0);
});

// A block-scope "use strict" must not make the scope strict either: a
// strict-mode reserved word used after it is valid sloppy code (matches Node).
test.concurrent(`a block-scope "use strict" does not make the scope strict`, async () => {
  using dir = tempDir("issue-31806-block-reserved", {
    "index.cjs": String.raw`
      function f() {
        { "use strict"; var package = 1; }
        return package;
      }
      console.log(f());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("1");
  expect(exitCode).toBe(0);
});
