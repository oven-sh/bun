import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for exponential backtracking in the CSS calc parser's
// `atan2()` math function, found by fuzzing `Bun.color()`.
//
// `Calc::parse_atan2` probes its arguments under several value types
// (length/percentage/angle/time/number), each re-descending the same argument
// subtree via `try_parse`. Because `atan2()` calls can nest inside one
// another's arguments, a nested `atan2()` was re-parsed once per ancestor
// type-probe, making parse time grow ~5x per nesting level: a 110-byte color
// value was already multiple seconds, and the 4 KB fuzzer input hung.
//
// A math function always resolves to an <angle> or a <number>, never to a
// length/time/percentage, so `parse_atan2` now parses each argument once as an
// <angle>/<number> expression and only re-parses it under a dimension type when
// the failure was a real dimension leaf (not a failed nested math function).
// That makes parsing linear in the nesting depth.
//
// The child process is given a kill switch so a regression fails the
// assertions below instead of hanging the test runner forever.

// A chain of `-(atan2(9 -(atan2(9 -(...` nested via subtraction. Each inner
// `atan2()` is missing its comma and fails to parse, so before the fix every
// ancestor type-probe re-descended the whole chain. This is a reduced form of
// the original fuzzer input.
function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// [input, expected Bun.color(input, "css") result].
// The hang inputs are invalid color values, so they resolve to `null`. The
// remaining cases pin down that valid `atan2()` usage is unchanged by the fix.
const cases: [css: string, expected: string | null][] = [
  // Reduced fuzzer repros: nested `atan2()` deep enough that the pre-fix
  // exponential blows up well past the kill switch.
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  // Deeply nested `atan2()` in the hue position — both the valid (each level
  // resolves to an angle) and invalid (type mismatch) shapes were exponential.
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  // Behavior preservation: valid `atan2()` with each supported argument type.
  ["hsl(atan2(9, 1) 50% 50%)", "#8dbf40"],
  ["hsl(atan2(atan2(9,1), atan2(2,3)) 50% 50%)", "#aebf40"],
  ["hsl(atan2(1deg, 2deg) 50% 50%)", "#bf7840"],
  ["hsl(atan2(1px, 2px) 50% 50%)", "#bf7840"],
  ["hsl(atan2(1s, 2s) 50% 50%)", "#bf7840"],
  ["hsl(atan2(50%, 25%) 50% 50%)", "#b8bf40"],
  // Type-passing functions parse their argument via the value type, so a
  // dimension inside them must still reach the dimension parse (they are not
  // <angle>/<number>-only functions). `calc()` holding a dimension, and the
  // type-passing `abs()`/`sign()` over a dimension, must all keep working — and
  // a (valid) `atan2()` nested inside `calc()` must still resolve to an angle.
  ["hsl(atan2(calc(1px + 1px), 2px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(calc(atan2(1px,2px)), 3deg) 50% 50%)", "#8dbf40"],
  ["hsl(atan2(abs(1px), abs(2px)) 50% 50%)", "#bf7840"],
  ["hsl(atan2(sign(1px), sign(2px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(sign(1s), sign(2s)) 50% 50%)", "#bf9f40"],
  // A type-dependent function in the *second* argument (after the first parses
  // as a number/angle) must still reach the dimension parse too, not just the
  // first — the fall-back applies symmetrically to both arguments.
  ["hsl(atan2(1, sign(1px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(sin(1), sign(1px)) 50% 50%)", "#bf9540"],
  ["hsl(atan2(1, sign(1s)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(1, calc(sign(1px))) 50% 50%)", "#bf9f40"],
  // Mismatched argument types are invalid and must still be rejected.
  ["hsl(atan2(atan2(9,1), 1) 50% 50%)", null],
];

test("deeply nested atan2() color values parse in linear time instead of hanging", async () => {
  const script = `
    const inputs = ${JSON.stringify(cases.map(([css]) => css))};
    console.log(JSON.stringify(inputs.map(css => Bun.color(css, "css"))));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix, the first input spun for many seconds.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
  // Outer timeout larger than the subprocess kill switch above, so a regression
  // trips the kill switch (and the assertions) rather than the test runner's
  // default timeout firing first.
}, 30_000);
