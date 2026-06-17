import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// Nests `atan2(<body> + atan2(<body> + ... + atan2(<body>)))` inside
// `hsl(sin(...))`. With `body = "min(1,2) + 0 + 0"` the first <angle> probe
// fails in `Calc::add` (on the `Sum.add(Number)` step) before reaching the
// nested atan2, so the math-fn-failure counter is never bumped there; the
// dimension fallbacks then each re-descend the nested chain.
function nestedAtan2Sum(body: string, depth: number): string {
  let s = "hsl(sin(1";
  for (let i = 0; i < depth; i++) s += ` + atan2(${body}`;
  return s + Buffer.alloc(depth + 2, ")").toString();
}

const fuzzInputHangMinSum = Buffer.from(
  Bun.gunzipSync(
    Buffer.from(
      "H4sIAAAAAAACA8soztEozsyDY13LUUAG4NLm0jW0MDExMzcxMTA3NjewNDU1NDM0HUDxxJLEPCMNoBhtlcPFwEArF5iGLLm0DCx1zE1hlOawNIdeBhFjATUcOWrGqBmjZoBUQiAtS4JBVLxpkgcBxzVbiDgIAAA=",
      "base64",
    ),
  ),
).toString("latin1");

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  [nestedAtan2Sum("min(1,2) + 0 + 0", 40), null],
  [nestedAtan2Sum("max(1,2) + 0 + 0", 40), null],
  [nestedAtan2Sum("clamp(1,2,3) + 0 + 0", 40), null],
  [nestedAtan2Sum("0 + min(1,2) + 0", 40), null],
  [nestedAtan2Sum("0 * min(1,2) + 0", 40), null],
  [fuzzInputHangMinSum, null],
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
  ["hsl(atan2(min(1px, 2px), 3px) 50% 50%)", "#bf6740"],
  ["hsl(atan2(min(1px, 2px) + 1px, 3px) 50% 50%)", "#bf8740"],
  ["hsl(atan2(min(1px, 2px) + 1px + 1px, 3px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(max(2%, 1%) + 1% + 1%, 4%) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(min(1s, 2s) + 0s + 0s, 1s) 50% 50%)", "#bf9f40"],
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
  expect(proc.signalCode, "subprocess was killed (hung parsing one of the inputs)").toBeNull();
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
}, 30_000);
