import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// A constant text that `eval` or `Function` is given is compiled ahead of time. Its frames are shown under its `//# sourceURL=`, as the engine reads that.
const thrower = "(function named() { throw new Error('boom'); })";
const texts: Record<string, string> = {
  "at the end": `${thrower}\n//# sourceURL=webpack://app/a.ts`,
  "with @": `${thrower}\n//@ sourceURL=webpack://app/b.ts`,
  "the last one counts": `//# sourceURL=webpack://app/first.ts\n${thrower}\n//# sourceURL=webpack://app/c.ts`,
  "spaces around the value": `${thrower}\n//# sourceURL=  webpack://app/d.ts  `,
  "inside the function": `(function named() {\n//# sourceURL=webpack://app/f.ts\nthrow new Error('boom'); })`,
};
// Each of these has no URL of its own, so its frame is shown under the file's.
const without: Record<string, string> = {
  "more behind the value takes an earlier one away": `//# sourceURL=webpack://app/first.ts\n${thrower}\n//# sourceURL=webpack://app/g.ts more`,
  "a quote in the value": `${thrower}\n//# sourceURL=webpack://app/'h'.ts`,
  "two spaces": `${thrower}\n//#  sourceURL=webpack://app/i.ts`,
  "no space": `${thrower}\n//#sourceURL=webpack://app/j.ts`,
  "a block comment": `${thrower}\n/*# sourceURL=webpack://app/k.ts */`,
  "in a string": `(function named() { throw new Error("\\n//# sourceURL=webpack://app/l.ts\\n"); })`,
  "an empty value": `${thrower}\n//# sourceURL=`,
};

const show = `
  const show = (name, run) => {
    try {
      run();
    } catch (error) {
      const frame = error.stack.split("\\n").find(line => line.includes(" at "));
      console.log(">", name, "|", /webpack:[^)]*/.exec(frame)?.[0] ?? "the file's");
    }
  };
`;
const calls = (all: Record<string, string>) =>
  Object.entries(all)
    .map(([name, text]) => `show(${JSON.stringify(name)}, () => (0, eval)(${JSON.stringify(text)})());`)
    .join("\n");
const program = `${show}
  ${calls(texts)}
  ${calls(without)}
  show("Function", () => new Function("throw new Error('boom');\\n//# sourceURL=webpack://app/m.ts")());
  show("Function, in a parameter", () => new Function("a = 1 //# sourceURL=webpack://app/n.ts\\n", "throw new Error('boom');")());
`;

const linesOf = (text: string) => text.split("\n").filter(line => line.startsWith("> "));

describe.concurrent("//# sourceURL= in a constant text", () => {
  test("an executable", async () => {
    using directory = tempDir("aot-source-url", { "main.js": program });
    const plain = await run([bunExe(), "main.js"], String(directory), bunEnv);
    expect(linesOf(plain.stdout)).toContain("> at the end | webpack://app/a.ts:1:36");
    expect(linesOf(plain.stdout)).toContain("> two spaces | the file's");
    expect(linesOf(plain.stdout)).toHaveLength(Object.keys(texts).length + Object.keys(without).length + 2);
    const outfile = join(String(directory), "main");
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", outfile],
      String(directory),
    );
    expect(build.exitCode).toBe(0);
    expect(linesOf((await run([outfile], String(directory), bunEnv)).stdout)).toEqual(linesOf(plain.stdout));
  });

  test("a test run", async () => {
    using directory = tempDir("aot-source-url", { "a.test.js": `${program}\ntest("one", () => {});` });
    const plain = await run([bunExe(), "test"], String(directory), bunEnv);
    expect(linesOf(plain.stdout)).toContain("> at the end | webpack://app/a.ts:1:36");
    const compiled = await run([bunExe(), "test", "--aot"], String(directory), bunEnv);
    expect(linesOf(compiled.stdout)).toEqual(linesOf(plain.stdout));
  });
});
