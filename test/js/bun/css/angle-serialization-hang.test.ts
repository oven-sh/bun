import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for an infinite loop in angle serialization.
//
// `Angle::to_css` decides whether to print a `rad` value as `deg` by comparing
// the printed lengths of both forms via `f32_length_with_5_digits`, which
// scales the value by 100000 and repeatedly divides by 10. For huge radian
// values (>= ~3.4e33), values near f32::MAX, or an infinity produced by
// `calc(infinity * 1rad)` or by the rad->deg conversion overflowing, the
// scaled value becomes infinity and dividing by 10 never makes progress, so
// serialization spun forever inside `fmodf`.
//
// The child process is given a kill switch so a regression fails the
// assertions below instead of hanging the test runner forever.

const cases: [css: string, expected: string][] = [
  // Fuzzer repros: huge radian values in a known property, an unknown
  // property (token list path), and an unparsed/invalid declaration.
  ["a { rotate: 99999999999999999999999999999999999999999999999999rad }", "a{rotate:3.40282e38rad}"],
  ["a { ro: 1.3157e308rad }", "a{ro:3.40282e38rad}"],
  [
    "a { rotate: 0.0000000000000000000000000000000000000\t00000000000000000000000000000000000200000000000000000000000000000001rad }",
    "a{rotate:0 2e+32rad}",
  ],
  // Other paths that serialize an Angle: transform functions and filters.
  ["a { transform: rotate(3.3e33rad) }", "a{transform:rotate(3.3e+33rad)}"],
  ["a { filter: hue-rotate(1e50rad) }", "a{filter:hue-rotate(3.40282e38rad)}"],
  // calc() can produce a real infinity.
  ["a { rotate: calc(infinity * 1rad) }", "a{rotate:3.40282e38rad}"],
  // Sanity check: small radian values still switch to degrees when shorter.
  ["a { transform: rotate(0.017453293rad) }", "a{transform:rotate(1deg)}"],
];

test("huge and non-finite radian angle values serialize instead of hanging", async () => {
  const script = `
    const { minifyTest } = require("bun:internal-for-testing").cssInternals;
    const inputs = ${JSON.stringify(cases.map(([css]) => css))};
    console.log(JSON.stringify(inputs.map(css => minifyTest(css, ""))));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix, serializing the first input spun forever.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
});
