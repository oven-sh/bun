import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A nesting shape that slipped past the `math_fn_parse_failures` tripwire from
// the earlier atan2() backtracking fix (atan2-backtracking-hang.test.ts): each
// atan2() argument is a *sum* whose leading term is a `min()`/product of
// unitless numbers (which can't fold to an <angle>), so the <angle> parse
// fails at that reduction — before it ever reaches the nested atan2() that
// would bump the tripwire. The length/percentage/time re-parses then
// re-descended the whole subtree, 4-5x per level. The fix re-checks the
// tripwire counter between those re-parses, so the first one to descend into
// the failing nested atan2() is also the last. (bun-fuzz)
//
// `leaf` is the innermost argument. A dimension leaf (e.g. `atan2(1px)`) must
// stay linear too: it makes the innermost atan2() fail without any folding
// shortcut, exercising the same one-descent-per-level bound.
function minAtan2Chain(depth: number, leaf: string = "atan2(73709551615)"): string {
  let inner = leaf;
  for (let i = 0; i < depth; i++) {
    inner = `atan2(73709551615 *min(9 *09,75 *09,75) + -18446744073709551615 + ${inner})`;
  }
  return `hsl(sin(sin(sin(${inner}))))`;
}

const cases: [css: string, expected: string | null][] = [
  // min()/product-led argument sums nested through atan2() (bun-fuzz repro).
  [minAtan2Chain(40), null],
  [minAtan2Chain(80), null],
  ["hsl(atan2(7 *min(9,75) + 1 + atan2(atan2(9))) 50% 50%)", null],
  ["hsl(atan2(max(1,2,3), min(4,5,6)) 50% 50%)", null],
  // Same chain with a dimension at the innermost leaf: a single `1px`/`1%`/`1s`
  // buried inside the nested atan2() must not re-open the dimension re-parses
  // at every enclosing level.
  [minAtan2Chain(40, "atan2(1px)"), null],
  [minAtan2Chain(80, "atan2(1px)"), null],
  [minAtan2Chain(40, "atan2(1%)"), null],
  [minAtan2Chain(40, "atan2(1s)"), null],
  // behavior preservation for the min()/max() argument shapes: a dimension
  // leaf is still reachable via the length re-parse.
  ["hsl(atan2(min(1px,2px), 3px) 50% 50%)", "#bf6740"],
  ["hsl(atan2(min(1,2), max(3,4)) 50% 50%)", null],
  ["hsl(atan2(min(1deg,2deg), 3deg) 50% 50%)", "#bf6740"],
  // dimensions buried inside nested type-dependent functions (calc/hypot)
  // keep folding via the length re-parse.
  ["hsl(atan2(calc(1px + 1px), calc(2px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(2px, calc(1px + 1px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(hypot(3px,4px), 5px) 50% 50%)", "#bf9f40"],
  // clamp() reduces to a Calc::Function (a Min of the max/center args), not a
  // Calc::Value, so atan2 can't reconcile it — pinned for behavior preservation.
  ["hsl(atan2(clamp(1px, 2px, 3px), 4px) 50% 50%)", null],
  // Unitless sums that can't fold to an <angle> still reach the Percentage
  // retry (no nested angle/number-only function fails, so the counter never
  // bumps), whose NaN fallback (`Percentage::from_calc` → NaN) resolves to an
  // `Angle::Rad(NaN)` color — unchanged from before the fix.
  ["hsl(atan2(min(1,2) + 3 + 4, min(5,6) + 7 + 8) 50% 50%)", "#bf4040"],
];

test.concurrent(
  "min()-led nested atan2() color values parse in linear time instead of hanging",
  async () => {
    const script = `
    const inputs = ${JSON.stringify(cases.map(([css]) => css))};
    console.log(JSON.stringify(inputs.map(css => Bun.color(css, "css"))));
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
    expect(exitCode).toBe(0);
  },
  30_000,
);

const fuzzerInputs: [name: string, blob: string][] = [
  [
    // 2,016 bytes of `hsl(sin(sin(sin(-Infinity + … atan2(… *min(9 *09,75 …`
    // with int-boundary numbers; hung Tokenizer::next_impl for 25s+ before the fix.
    "min()-led atan2 chain",
    "H4sIAAAAAAACA8soztEozsyDY13PvLTMvMySSi5tLl1DCxMTM3MTEwNzY3MDS1NTQzND0wEUTyxJzDPSAIrRVjlcDAy0coGhYsmlZWCpY24KozTpYE5BfrnGYHPTqDkDac6oMaPGDH1jSDfHKi2zqLhENz9Nt6SyIBWHqYMvv0pRwxxNZKiEyiUGAgDmlnNY4AcAAA==",
  ],
  [
    // 1,840-byte variant of the same class: the chain bottoms out in a
    // `color(from atan2(…))` token (fails with no tripwire bump at the leaf)
    // and several `min()`s are left unclosed so their last argument swallows
    // the next nested atan2(). Exponential before the fix (~2x per level).
    "min()-led atan2 chain ending in color(from …)",
    "H4sIAAAAAAAAA8soztEozsyDY10jQxNzEwtjMxNLLm0uXUMLExMzcxMTA3NjcwNLU1NDM0PTARRPLEnMM9IwNzanrXK4GBho5WbmaVhyaRlY6pibwijNYWnOqEFEhdGQCb1Rq0fT/UAmSq2BKvKS83PyizTSivJzFSAmcHFhMVuTdAgAPqXrnDAHAAA=",
  ],
];

test.concurrent.each(fuzzerInputs)(
  "the exact fuzzer-minimized nested-math input parses instead of hanging: %s",
  async (_name, blob) => {
    const script = `
    const input = Buffer.from(Bun.gunzipSync(Buffer.from(${JSON.stringify(blob)}, "base64"))).toString("latin1");
    console.log(JSON.stringify(Bun.color(input, "rgba")));
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBeNull();
    expect(exitCode).toBe(0);
  },
  30_000,
);
