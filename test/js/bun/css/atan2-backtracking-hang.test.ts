import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// Nesting atan2() via an argument that the <angle> attempt rejects at the
// add() step (Product + Number) but the <length>/<percentage> attempts accept
// and descend into. Without the unrecoverable-failure guard on the dimension
// fallbacks each level re-descends twice, so depth N takes 2^N.
function productSumAtan2Chain(depth: number): string {
  let s = "hsl(sin(1 + atan2(";
  for (let i = 0; i < depth; i++) s += "2 * min(1,2) + 1 + atan2(";
  return s + "1" + Buffer.alloc(depth + 3, ")").toString();
}

// The fuzzer-minimized reproduction (2074 bytes) that first exposed the
// Product + Number variant of this backtracking.
const fuzzProductSumInput = Bun.gunzipSync(
  Buffer.from(
    "H4sIAAAAAAACA8soztEozsyDY13LUUAG4NLm0jW0MDExMzcxMTA3NjewNDU1NDM0HUDxxJLEPCMNoBhtlcPFwEArF5iGLLm0DCx1zE1hlOaQNGco6iXkd3oZRIwF1HDkqBmjZpBrBm3zzSAqCDXJgwBGtHpjGggAAA==",
    "base64",
  ),
).toString("latin1");

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [nestedAtan2Chain(64), null],
  ["hsl(" + Buffer.alloc(6 * 64, "atan2(").toString() + "9, 1" + Buffer.alloc(64, ")").toString() + " 50% 50%)", null],
  [productSumAtan2Chain(40), null],
  [productSumAtan2Chain(64), null],
  [fuzzProductSumInput, null],
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
  ["hsl(atan2(min(1px, 2px), 1px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(2 * min(1px, 2px), 1px) 50% 50%)", "#b8bf40"],
  ["hsl(atan2(1px + min(1px,2px), 1px) 50% 50%)", "#b8bf40"],
  ["hsl(atan2(min(10%, 20%), 5%) 50% 50%)", "#b8bf40"],
  ["hsl(atan2(min(1s, 2s), 1s) 50% 50%)", "#bf9f40"],
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

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
  expect(exitCode).toBe(0);
}, 30_000);
