import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// `SupportsCondition::{Unknown,Selector,Declaration}` hold raw slices of the
// parser input. Printing them via `write_str` debug-asserted on embedded
// newlines (found by fuzzing `@supports (color: lab(0%\n 0 \r\n0))`). In
// release builds the same path silently desynced the printer's line/col
// tracking instead of panicking.

test("`@supports` condition containing a literal newline prints without panicking", () => {
  // Unknown variant: a parenthesised condition the parser stores verbatim.
  const unknown = "@supports (color: lab(0%\n 0 \r\n0)) {.x{color:red}}";
  const unknownMin = "@supports (color: lab(0%\n 0 \r\n0)){.x{color:red}}";
  expect(minifyTest(unknown, "")).toBe(unknownMin);
  expect(minifyTest(unknownMin, "")).toBe(unknownMin);

  // Selector variant: `selector(...)` body is a raw input slice.
  expect(minifyTest("@supports selector(a\n b) {.x{color:red}}", "")).toBe("@supports selector(a\n b){.x{color:red}}");

  // Declaration variant via `@import ... supports(...)`: the value is a raw input slice.
  expect(minifyTest("@import url(x.css) supports(color: lab(0%\n 0 0));", "")).toBe(
    '@import "x.css" supports(color:lab(0%\n 0 0));',
  );
});

test("fuzzer-minimized input: `@supports` condition with `\\n` and `\\r\\n`", async () => {
  // Run in a child process so a panic doesn't take down the test runner.
  const input =
    "LmZvbyB7CiAgICAgICAgLS1jdXN0b206ICNiMzIzMjMgIWltcG9ydGFudDsKICAgICAgfQoKICAgICAgQHN1cHBvcnRzIChjb2xvcjogbGFiKDAlCiAwIA0KMCkpIHsKICAgICAgICAuZm9vIHsKICAgICAgICAgIC0tY3VzdG9tOiBsYWIoNDAlIDU2LjYgMzkpICFpbXBvcnRhbnQ7CiAgICAgICAgfQogICAgICB9";
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const c = require("bun:internal-for-testing").cssInternals;
       const i = atob(${JSON.stringify(input)});
       const m = c.minifyTest(i, "");
       c._test(i, "", { chrome: 80 << 16 });
       c.prefixTest(i, "", { chrome: 80 << 16 });
       // Round-trip the minified output through the minifier again.
       if (c.minifyTest(m, "") !== m) throw new Error("round-trip mismatch");
       console.log(JSON.stringify(m));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), exitCode }).toEqual({
    stdout: JSON.stringify(
      ".foo{--custom:#b32323!important}@supports (color: lab(0%\n 0 \r\n0)){.foo{--custom:lab(40% 56.6 39)!important}}",
    ),
    exitCode: 0,
  });
  void stderr;
});
