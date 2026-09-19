// https://github.com/oven-sh/bun/issues/43476
//
// In an async function, `await` is not an identifier in the parameters of an arrow function. JavaScriptCore
// accepted it when the arrow function was in a "( ... )" that the parser first tried as a parameter list, in a
// scope that is never async, and then parsed again: the second parse took the arrow function from the parser's
// function cache. A class static block reserves `await` the same way. The text goes through `eval`, so Bun's
// transpiler is not involved.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const invalid = [
  "(async function () { [a = (b = (await) => 1)] = []; })",
  "(async function () { [a = ({ [(await) => 1]: 1 })] = []; })",
  "(async () => { [a = (b = (c = await) => c)] = []; })",
  "(async function* () { [a = (b = ({ await }) => 1)] = []; })",
  "(async function () { ({ a = (b = (await) => 1) } = {}); })",
  "(async function () { (await) => 1; })",
  "(class { static { ({ a = (await) => 1 }) => a; } })",
  "(class { static { ({ x = 1 }, a = (b = await) => b) => a; } })",
];

// `await` is an identifier in the body of a function that is not async, also one nested in those parameters.
const valid = [
  "(async function () { [a = (b = (c = function () { var await; }) => c)] = []; })",
  "(async function () { [a = (b = (c = () => await) => c)] = []; })",
  "(function () { [a = (b = (await) => 1)] = []; })",
  "(async function () { () => { [a = (b = (await) => 1)] = []; }; })",
  "(class { static { () => { ({ a = (await) => 1 }) => a; }; } })",
];

const script = `
  const results = {};
  for (const source of ${JSON.stringify([...invalid, ...valid])}) {
    try {
      (0, eval)(source);
      results[source] = "accepted";
    } catch (e) {
      results[source] = e.name;
    }
  }
  console.log(JSON.stringify(results));
`;

test("await is not a parameter name of an arrow function nested in a pattern in an async function", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    ...Object.fromEntries(invalid.map(source => [source, "SyntaxError"])),
    ...Object.fromEntries(valid.map(source => [source, "accepted"])),
  });
  expect(exitCode).toBe(0);
});
