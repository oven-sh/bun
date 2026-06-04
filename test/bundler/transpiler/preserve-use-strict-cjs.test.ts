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
  test(`"use strict" with a non-simple parameter list is a SyntaxError (.${ext})`, async () => {
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
test(`escaped "use strict" is not a directive (runs sloppy, no early error)`, async () => {
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
