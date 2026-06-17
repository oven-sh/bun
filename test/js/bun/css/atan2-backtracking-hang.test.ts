import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// `Angle::from_calc` rejects the `Product` produced by `2 * min(2, 2)` before
// ever reaching the nested `atan2`, so the `hit_unrecoverable` guard on the
// initial Angle attempt never trips. The `Length` and `Percentage` fallbacks
// (whose `from_calc` wrap any `Calc`) then each re-descend the full subtree,
// giving 2^depth parses unless each fallback re-checks the failure counter.
function nestedAtan2WithUnreducedArg(depth: number, inner: string): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += `atan2(2 * ${inner} + 2 + `;
  body += "1";
  return "hsl(" + body + Buffer.alloc(depth + 1, ")").toString();
}

const fuzzerInput = Buffer.from(
  Bun.gunzipSync(
    Buffer.from(
      "H4sIAAAAAAACA8soztEozsyDY13LUUAG4NLm0jW0MDExMzcxMTA3NjewNDU1NDM0xRAnShH54okliXlGGkAx2iqHi4GBVi4w4VhyaRlY6pibwijNwWnOUHAsToNoqZpqjiQ+CZFr9qgZQ8WMoeAjKiZ6LAYNouJGkzwIAHESI0siCAAA",
      "base64",
    ),
  ),
).toString("latin1");

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  [nestedAtan2WithUnreducedArg(40, "min(2, 2)"), null],
  [nestedAtan2WithUnreducedArg(40, "max(2, 2)"), null],
  [nestedAtan2WithUnreducedArg(40, "clamp(2, 2, 2)"), null],
  [nestedAtan2WithUnreducedArg(64, "min(2, 2)"), null],
  [fuzzerInput, null],
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

  expect({ stderr, signalCode: proc.signalCode }).toEqual({ stderr: "", signalCode: null });
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
}, 30_000);
