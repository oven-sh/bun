import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// `5*min(9,7)` parses as `Calc::Product` (not `Calc::Function`), and
// `Product + Number` is rejected by `Angle::from_calc` before the nested
// `atan2` is reached, so the failure-counter guard on the angle attempt
// never fires. `Length::from_calc` / `Percentage::from_calc` both accept
// `Product`, so without a check between dimension probes each of those
// fallbacks independently recurses into the nested `atan2()`.
function nestedAtan2Product(depth: number): string {
  let s = "1";
  for (let i = 0; i < depth; i++) s = `atan2(5*min(9,7) + 1 + ${s})`;
  return `hsl(sin(sin(sin(${s}))))`;
}

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  [nestedAtan2Product(40), null],
  [nestedAtan2Product(64), null],
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
  ["hsl(atan2(min(1px,2px), 2px) 50% 50%)", "#bf7840"],
  ["hsl(atan2(5*min(1px,2px) + 1px, 2px) 50% 50%)", "#a7bf40"],
  ["hsl(atan2(5*min(50%,25%) + 10%, 20%) 50% 50%)", "#91bf40"],
  ["hsl(atan2(5*min(1s,2s) + 1s, 2s) 50% 50%)", "#a7bf40"],
  ["hsl(atan2(5*max(1px,2px) + 1px, 2px) 50% 50%)", "#95bf40"],
  ["hsl(atan2(5*min(9,7) + 1, 2) 50% 50%)", null],
  ["hsl(atan2(1deg + atan2(1px, 2px), 2deg) 50% 50%)", "#88bf40"],
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
