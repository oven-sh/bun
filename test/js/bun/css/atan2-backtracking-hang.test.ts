import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// A second nesting shape that slipped past the `math_fn_parse_failures`
// tripwire: each atan2() argument is a *sum* whose leading term is a
// `min()`/product of unitless numbers (which can't fold to an <angle>), so the
// <angle> parse fails at that reduction — before it ever reaches the nested
// atan2() that would bump the tripwire. The length/time/percentage re-parses
// then re-descended the whole subtree, 4-5x per level. (bun-fuzz)
function minAtan2Chain(depth: number): string {
  let inner = "atan2(73709551615)";
  for (let i = 0; i < depth; i++) {
    inner = `atan2(73709551615 *min(9 *09,75 *09,75) + -18446744073709551615 + ${inner})`;
  }
  return `hsl(sin(sin(sin(${inner}))))`;
}

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  ["hsl(atan2(9, 1) 50% 50%)", "#8dbf40"],
  ["hsl(atan2(atan2(9,1), atan2(2,3)) 50% 50%)", "#aebf40"],
  ["hsl(atan2(1deg, 2deg) 50% 50%)", "#bf7840"],
  ["hsl(atan2(1px, 2px) 50% 50%)", "#bf7840"],
  ["hsl(atan2(1s, 2s) 50% 50%)", "#bf7840"],
  ["hsl(atan2(50%, 25%) 50% 50%)", "#b8bf40"],
  ["hsl(atan2(calc(1px + 1px), 2px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(calc(atan2(1px,2px)), 3deg) 50% 50%)", "#8dbf40"],
  ["hsl(atan2(abs(1px), abs(2px)) 50% 50%)", "#bf7840"],
  ["hsl(atan2(sign(1px), sign(2px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(sign(1s), sign(2s)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(1, sign(1px)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(sin(1), sign(1px)) 50% 50%)", "#bf9540"],
  ["hsl(atan2(1, sign(1s)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(1, calc(sign(1px))) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(atan2(9,1), 1) 50% 50%)", null],
  // min()/product-led argument sums nested through atan2() (bun-fuzz repro).
  [minAtan2Chain(40), null],
  [minAtan2Chain(80), null],
  ["hsl(atan2(7 *min(9,75) + 1 + atan2(atan2(9))) 50% 50%)", null],
  ["hsl(atan2(max(1,2,3), min(4,5,6)) 50% 50%)", null],
  // behavior preservation for the min()/max() argument shapes the fix gates:
  // a dimension leaf is still reachable via the length re-parse.
  ["hsl(atan2(min(1px,2px), 3px) 50% 50%)", "#bf6740"],
  ["hsl(atan2(min(1,2), max(3,4)) 50% 50%)", null],
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
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
}, 30_000);

test("the exact fuzzer-minimized nested-math input parses instead of hanging", async () => {
  // 2,016 bytes of `hsl(sin(sin(sin(-Infinity + … atan2(… *min(9 *09,75 …`
  // with int-boundary numbers; hung Tokenizer::next_impl for 25s+ before the fix.
  const blob =
    "H4sIAAAAAAACA8soztEozsyDY13PvLTMvMySSi5tLl1DCxMTM3MTEwNzY3MDS1NTQzND0wEUTyxJzDPSAIrRVjlcDAy0coGhYsmlZWCpY24KozTpYE5BfrnGYHPTqDkDac6oMaPGDH1jSDfHKi2zqLhENz9Nt6SyIBWHqYMvv0pRwxxNZKiEyiUGAgDmlnNY4AcAAA==";
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
}, 30_000);
