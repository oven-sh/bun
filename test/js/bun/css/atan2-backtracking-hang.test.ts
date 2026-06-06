import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function nestedAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "-(atan2(9\n";
  body += "-(atan2(";
  return `hsl(sin(2\n${body}` + Buffer.alloc(depth + 3, ")").toString();
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

// A second fuzzer-found family that defeated the "first attempt only" guard:
// a non-foldable min() product makes the Angle attempt fail in add() before
// it ever reaches the nested atan2 (so no unrecoverable failure is recorded),
// after which BOTH the Length and the Percentage fallbacks parse past the
// product and re-descend into the nested atan2, doubling the parse work per
// nesting level. The unrecoverable-failure check now runs after every failed
// fallback attempt, not just the first.
function minProductAtan2Chain(depth: number): string {
  let body = "";
  for (let i = 0; i < depth; i++) body += "atan2(5 * min(9, 7) + 1 + ";
  return `hsl(sin(${body}1deg, 2${Buffer.alloc(depth, ")").toString()}) 50% 50%)`;
}

// The original 1990-byte fuzzer input (newlines and all), base64-encoded.
const fuzzerInputBase64 =
  "aHNsKHNpbihzaW4oc2luKC0yMTQ3NDgzNjQ5CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3NzM3MDk1NTE2MTUKKwotMTg0NDY3NDQwNzM3MDk1NTE2MTUKKwphdGFuMig3Mzc3MzcwOTU1MTYxNQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzc1CikKKwotMTg0NDY3NDQwNzM3MDk1NTE2MTUKKwphdGFuMig3MzcwOTU1MTYxNQoKCgoKCiptaW4oOQoqMDksNzUKKjA5LDc3NQopCisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzc1CikKKwotMTg0NDY3NDQwNzM3MDk1NTE2MTUKKwphdGFuMig3MzcwOTU1MTYxNQoKCgoKCiptaW4oOQoqMDksNzUKKjA5LDc3NQopCisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKCgoKCiptaW4oOQoqMDksNzUKKjA5LDc3NQopCisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzc1CikKKwotMTg0NDY3NDQwNzM3MDk1NTE2MTUKKwphdGFuMig3MzcwOTU1MTYxNQoKCgoKCiptaW4oOQoqMDksNzUKKjA5LDc3NQopCisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKCgoqbWluKDkKKjA5LDc1CiowOSw3NzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzc1CikKKwotMTg0NDY3NDQwNzM3MDk1NTE2MTUKKwphdGFuMig3MzcwOTU1MTYxNQoKCgoKCiptaW4oOQoqMDksNzUKKjA5LDc3NQopCisKLTE4NDQ2NzQ0MDczNzA5NTUxNjE1CisKYXRhbjIoNzM3MDk1NTE2MTUKCgoKKm1pbig5CiowOSw3NQoqMDksNzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmF0YW4yKDczNzA5NTUxNjE1CgoKCgoKKm1pbig5CiowOSw3NQoqMDksNzUKKQorCi0xODQ0Njc0NDA3MzcwOTU1MTYxNQorCmNvbG9yKGZyb20gCgoKCgoKCgoKYXRhbjIoNzM3MDk1NTE2MTUKKQopCikKKQopCikKKQopCikKKQopCikKKQopCikKKQopCikKKQopCikKKQopCikKKQopCikKKQ==";

test("nested atan2() behind a min() product parses in linear time instead of hanging", async () => {
  const chainCases: [css: string, expected: string | null][] = [
    [minProductAtan2Chain(40), null],
    [minProductAtan2Chain(64), null],
  ];
  const script = `
    const inputs = ${JSON.stringify(chainCases.map(([css]) => css))};
    inputs.push(Buffer.from(${JSON.stringify(fuzzerInputBase64)}, "base64").toString());
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
  expect(JSON.parse(stdout)).toEqual([...chainCases.map(([, expected]) => expected), null]);
  expect(exitCode).toBe(0);
}, 30_000);
