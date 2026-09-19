import type { Subprocess } from "bun";
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// oven-sh/WebKit#699. JavaScriptCore parsed the text of an arrow function with parenthesized parameters three times, and
// an arrow function in those parameters did the same to its own text: every level of nesting more than doubled the
// parse time. Depth 24 took 17 seconds and depth 40 does not finish.

const depth = 40;

// [text before the innermost value, text after it]
const shapes: [string, string][] = [
  ["(a = ", ") => a"],
  ["(b, a = ", ", ...rest) => a"],
  ["({ a = ", " }) => a"],
  ["([a = ", "]) => a"],
  ["async (a = ", ") => a"],
  ["id((a = ", ") => a)"],
];

const repeat = (value: string, count: number) => Buffer.alloc(value.length * count, value).toString();
const nest = ([before, after]: [string, string]) => repeat(before, depth) + "'innermost'" + repeat(after, depth);

// A parser that does not finish cannot stop itself, and the test runner does not stop the child of a test that timed
// out. So each child is killed after `childTimeout`, and a child that is still there when the file is done is killed
// then.
const childTimeout = 15_000;
const children: Subprocess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
});

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: childTimeout,
  });
  children.push(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("eval() of arrow functions nested in parameter default values finishes", async () => {
  const source = `
    globalThis.id = value => value;
    const sources = ${JSON.stringify(shapes.map(nest))};
    const results = [];
    for (const source of sources) {
      results.push(typeof (0, eval)(source));
      results.push(typeof new Function("return " + source)());
    }
    // The default values still evaluate from the inside out.
    let value = (0, eval)(sources[0]);
    for (let i = 0; i < ${depth}; i++) value = value();
    results.push(value);
    console.log(results.join(","));
  `;
  expect(await run(["-e", source])).toEqual({
    stdout: repeat("function,", shapes.length * 2) + "innermost\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("a module with arrow functions nested in parameter default values loads", async () => {
  // The transpiler passes the nest through, so JavaScriptCore parses the same text when it loads the module.
  using dir = tempDir("jsc-nested-arrow-functions", {
    "nest.mjs": `
      const id = value => value;
      export const functions = [${shapes.map(nest).join(",\n")}];
    `,
    "index.mjs": `
      import { functions } from "./nest.mjs";
      let value = functions[0];
      for (let i = 0; i < ${depth}; i++) value = value();
      console.log(functions.map(f => typeof f).join(","), value);
    `,
  });
  expect(await run([join(String(dir), "index.mjs")], String(dir))).toEqual({
    stdout: Array(shapes.length).fill("function").join(",") + " innermost\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("what an arrow function in a default value may hold still depends on what encloses it", () => {
  // The parser checks the parameters of a nested arrow function on every pass. `await` is a parameter name of the inner
  // function in the pass that reads the outer parentheses as an expression, and an error once the outer function is
  // known to be async.
  const messageOf = (source: string) => {
    try {
      (0, eval)(source);
    } catch (e: any) {
      return `${e.name}: ${e.message}`;
    }
    return "no error";
  };
  expect({
    plain: messageOf("(a = (await) => 1) => a"),
    asyncArrow: messageOf("async (a = (await) => 1) => a"),
    asyncFunction: messageOf("(async function () { (a = (b = (await) => 1) => b) => a; })"),
    duplicate: messageOf("(a = (b = (c, c) => c) => b) => a"),
  }).toEqual({
    plain: "no error",
    asyncArrow: "SyntaxError: Cannot use 'await' within a parameter default expression.",
    asyncFunction: "SyntaxError: Cannot use 'await' within a parameter default expression.",
    duplicate: "SyntaxError: Duplicate parameter 'c' not allowed in an arrow function.",
  });
});
