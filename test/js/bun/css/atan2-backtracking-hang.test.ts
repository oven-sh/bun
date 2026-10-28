import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
}

// The leading min() of plain numbers fails as an <angle> before the nested atan2() is reached.
function minAtan2Chain(depth: number): string {
  let inner = "atan2(1)";
  for (let i = 0; i < depth; i++) inner = `atan2(2 * min(9, 75) + -1 + ${inner})`;
  return `hsl(sin(${inner}))`;
}

const cases: [css: string, expected: string | null][] = [
  [nestedAtan2Chain(40), null],
  [minAtan2Chain(40), null],
  [minAtan2Chain(80), null],
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
  ["hsl(atan2(1px, 1s) 50% 50%)", null],
  ["hsl(atan2(1px + 1s, 1px) 50% 50%)", null],
  ["hsl(atan2(1px + 1s - 1s, 1px) 50% 50%)", null],
  ["hsl(atan2(min(1px, 1s), 1px) 50% 50%)", null],
  ["hsl(atan2(1px + 1em - 1em, 1px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(1in, 96px) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(1s, 1000ms) 50% 50%)", "#bf9f40"],
  // sign() gives a number for every type.
  ["hsl(atan2(sign(1px), sign(1s)) 50% 50%)", "#bf9f40"],
  ["hsl(atan2(sign(1px) * 1s, 1s) 50% 50%)", "#bf9f40"],
  // A length plus a number is no length, also when the length is zero.
  ["hsl(atan2(0px + 5, 1) 50% 50%)", null],
  // The end of the input closes every block.
  ["lch(50% 50 atan2(1, sign(1s", "lch(50% 50 45)"],
];

// Every level is valid: the nested function parses, and the value after it is not an angle.
function validChain(depth: number, level: (inner: string, i: number) => string, leaf = "atan2(1s, 1s)"): string {
  let inner = leaf;
  for (let i = 0; i < depth; i++) inner = level(inner, i);
  return inner;
}

// Each of these is a number when `inner` is 45deg.
const numberFunctions: ((inner: string) => string)[] = [
  inner => `sin(${inner})`,
  inner => `cos(${inner})`,
  inner => `tan(${inner})`,
  inner => `pow(sin(${inner}), 2)`,
  inner => `sqrt(cos(${inner}))`,
  inner => `exp(sin(${inner}))`,
  inner => `log(cos(${inner}) + 1)`,
  inner => `sin(asin(sin(${inner})))`,
  inner => `cos(acos(cos(${inner})))`,
  inner => `tan(atan(tan(${inner})))`,
  inner => `sin(atan2(sin(${inner}), 1))`,
];

const secondsChain = validChain(40, inner => `atan2(sin(${inner}) * 1s, 1s)`);

const validColors: [css: string, expected: string][] = [
  [`hsl(${secondsChain} 50% 50%)`, "#bf5340"],
  [`hsl(${validChain(40, inner => `atan2(sin(${inner}) * 1%, 1%)`, "atan2(1%, 1%)")} 50% 50%)`, "#bf5340"],
  [`hsl(${validChain(40, inner => `atan2(sin(${inner}) * 1px, 1px)`, "atan2(1px, 1px)")} 50% 50%)`, "#bf5340"],
  // `x * 0s + 1s` is 1s at every level, so each of these is 45deg.
  [
    `hsl(${validChain(44, (inner, i) => `atan2(${numberFunctions[i % numberFunctions.length](inner)} * 0s + 1s, 1s)`)} 50% 50%)`,
    "#bf9f40",
  ],
  [`hsl(${validChain(40, inner => `atan2(calc(abs(min((sin(${inner}) * 0s + 1s), 2s))), 1s)`)} 50% 50%)`, "#bf9f40"],
  [`hsl(${validChain(40, inner => `atan2(1s, cos(${inner}) * 0s + 1s)`)} 50% 50%)`, "#bf9f40"],
  [`hsl(${validChain(6, inner => `atan2(sin(${inner}) * 0s + cos(${inner}) * 0s + 1s, 1s)`)} 50% 50%)`, "#bf9f40"],
  [`hsl(atan2(${Buffer.alloc(14 * 200, "sin(1) * 0s + ").toString()}1s, 1s) 50% 50%)`, "#bf9f40"],
];

const validRules: [css: string, expected: string][] = [
  [`a{rotate:${secondsChain}}`, "a{rotate:.154922rad}"],
  [`a{transition-duration:calc(1s*sin(${secondsChain}))}`, "a{transition-duration:.154303s}"],
];

// Runs `script` in a process that is killed when it does not exit.
async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent(
  "deeply nested atan2() color values parse in linear time instead of hanging",
  async () => {
    const { stdout, stderr, exitCode } = await run(`
      const inputs = ${JSON.stringify(cases.map(([css]) => css))};
      console.log(JSON.stringify(inputs.map(css => Bun.color(css, "css"))));
    `);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(cases.map(([, expected]) => expected));
    expect(exitCode).toBe(0);
  },
  30_000,
);

test.concurrent(
  "a valid chain of nested atan2() parses in linear time",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(`
      const { minifyTest } = require("bun:internal-for-testing").cssInternals;
      const [colors, rules] = ${JSON.stringify([validColors.map(([css]) => css), validRules.map(([css]) => css)])};
      console.log(JSON.stringify([colors.map(css => Bun.color(css, "css")), rules.map(css => minifyTest(css, ""))]));
    `);

    expect({ output: stdout && JSON.parse(stdout), stderr, exitCode, signalCode }).toEqual({
      output: [validColors.map(([, expected]) => expected), validRules.map(([, expected]) => expected)],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  30_000,
);
