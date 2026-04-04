import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28864
//
// Pyodide (and other isomorphic libraries) detect the Node-like runtime using
//   typeof process.browser === "undefined"
// or its minified form
//   typeof process.browser > "u"
//
// Bun previously defined `process.browser` as `false` both at the transpiler
// level (via a default define) and at runtime (via a process getter). That
// caused pyodide to conclude it wasn't in any supported environment and throw
// "Cannot determine runtime environment". Node.js leaves `process.browser`
// undefined, so Bun should too.

test("process.browser is undefined at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.log(JSON.stringify({ type: typeof process.browser, value: process.browser }))",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout.trim())).toEqual({ type: "undefined", value: undefined });
  expect(exitCode).toBe(0);
});

test("process.browser is undefined via dynamic access", async () => {
  // Dynamic bracket access bypasses any transpiler-time define substitution
  // and reflects the real runtime property.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      [
        "const key = 'browser';",
        "const p = process;",
        "console.log(JSON.stringify({",
        "  bracket: typeof process[key],",
        "  aliased: typeof p.browser,",
        "  hasOwn: Object.prototype.hasOwnProperty.call(process, 'browser'),",
        "  inOperator: 'browser' in process,",
        "}));",
      ].join(" "),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout.trim())).toEqual({
    bracket: "undefined",
    aliased: "undefined",
    hasOwn: false,
    inOperator: false,
  });
  expect(exitCode).toBe(0);
});

test("pyodide-style environment detection succeeds", async () => {
  // This is the exact minified expression from pyodide.mjs that was failing.
  // `typeof undefined > "u"` is true (string comparison: "undefined" > "u"),
  // but `typeof false > "u"` is false ("boolean" < "u").
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      [
        "const isNodeLike =",
        '  typeof process == "object" &&',
        '  typeof process.versions == "object" &&',
        '  typeof process.versions.node == "string" &&',
        '  typeof process.browser > "u";',
        "if (!isNodeLike) { throw new Error('Cannot determine runtime environment'); }",
        "console.log('ok');",
      ].join(" "),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("transpiler does not substitute process.browser when target is bun", async () => {
  // `bun build --target=bun` should behave like the runtime: leave
  // `process.browser` untouched so it resolves to the real (undefined) value.
  using dir = tempDir("28864-build", {
    "entry.js": "console.log(typeof process.browser);\n",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--no-bundle", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // Expression should NOT have been folded to the string "boolean".
  // The exact form is preserved (or at most lightly rewritten), but must
  // still reference `process.browser`.
  expect(stdout).toContain("process.browser");
  expect(stdout).not.toContain('"boolean"');
  expect(exitCode).toBe(0);
});
