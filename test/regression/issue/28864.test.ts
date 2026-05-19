import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28864
//
// Pyodide (and other isomorphic libraries) detect the Node-like runtime using
// `typeof process.browser === "undefined"` (or its minified `typeof ... > "u"`
// form). Bun previously defined `process.browser` as `false` both at the
// transpiler level and at runtime, causing pyodide to throw "Cannot determine
// runtime environment". Node.js leaves `process.browser` undefined; Bun should
// too.

test("process.browser is undefined at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      [
        "const key = 'browser';",
        "console.log(JSON.stringify({",
        "  typeofDirect: typeof process.browser,",
        "  typeofDynamic: typeof process[key],", // bypasses any define substitution
        "  value: process.browser,",
        "  hasOwn: Object.prototype.hasOwnProperty.call(process, 'browser'),",
        "  inOperator: 'browser' in process,",
        // Exact minified pyodide check: `typeof undefined > "u"` is true.
        '  pyodideOk: typeof process.browser > "u",',
        "}));",
      ].join(" "),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout.trim())).toEqual({
    typeofDirect: "undefined",
    typeofDynamic: "undefined",
    value: undefined,
    hasOwn: false,
    inOperator: false,
    pyodideOk: true,
  });
  expect(exitCode).toBe(0);
});

test("Bun.Transpiler does not substitute process.browser when target is bun", () => {
  // Matches runtime behaviour: `process.browser` must not be folded to a literal.
  const out = new Bun.Transpiler({ target: "bun" }).transformSync("typeof process.browser");
  expect(out).toContain("process.browser");
  expect(out).not.toContain('"boolean"');
});
