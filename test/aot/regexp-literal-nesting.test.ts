import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// How deep the groups of a pattern can be nested is limited by the stack of whoever builds the pattern. A literal within the limit matches. One beyond it throws a SyntaxError where it is
// evaluated, and the same text handed to RegExp throws a RangeError. A try around either catches the error, and the program goes on.
function program(open: string, close: string, depth: number): string {
  const literal = `/${open.repeat(depth)}a${close.repeat(depth)}/`;
  return `
function create() { return ${literal}; }
function show(label, run) {
  try { console.log(label, run()); } catch (error) { console.log(label, "throws", error.name, error.message); }
}
try { console.log("at the top level", ${literal}.test("a")); } catch (error) { console.log("at the top level throws", error.name, error.message); }
show("in a function", () => create().test("a"));
show("in a function again", () => create().test("b"));
show("text that is a constant", () => new RegExp(${JSON.stringify(open)}.repeat(${depth}) + "a" + ${JSON.stringify(close)}.repeat(${depth})).test("a"));
show("text made at run time", () => new RegExp(${JSON.stringify(open)}.repeat(${depth} + process.argv.length - process.argv.length) + "a" + ${JSON.stringify(close)}.repeat(${depth})).test("a"));
console.log("end");
`;
}

test.concurrent.each([
  ["groups", "(?:", ")", 300, "true"],
  ["captures", "(", ")", 300, "true"],
  ["lookaheads", "(?=", ")", 300, "true"],
  ["repeated groups", "(?:", ")*", 300, "true"],
  ["groups", "(?:", ")", 150_000, "throws SyntaxError"],
  ["lookaheads", "(?=", ")", 150_000, "throws SyntaxError"],
] as const)(
  "%s written as %s..%s nested %d deep: %s",
  async (_, open, close, depth, answer) => {
    using folder = tempDir("aot-regexp-literal-nesting", { "program.cjs": program(open, close, depth) });
    const spawn = (cmd: string[]) =>
      Bun.spawn({ cmd, cwd: String(folder), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    await using build = spawn([bunExe(), "build", "--compile", "--aot", "program.cjs", "--outfile", "program"]);
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: buildErrors, exitCode: buildExitCode, signalCode: build.signalCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b|crashed/m),
      exitCode: 0,
      signalCode: null,
    });
    await using plain = spawn([bunExe(), "run", "program.cjs"]);
    await using compiled = spawn([join(String(folder), "program")]);
    const [expected, stdout, exitCode] = await Promise.all([
      plain.stdout.text(),
      compiled.stdout.text(),
      compiled.exited,
    ]);
    expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
    expect(expected).toStartWith(`at the top level ${answer}`);
    expect(expected).toEndWith("end\n");
  },
  120_000,
);
