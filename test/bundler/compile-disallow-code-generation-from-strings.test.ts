import { describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";
import { canTrim } from "./compile-trim-features";

const flag = "--disallow-code-generation-from-strings";
const refused = "EvalError: Code generation from strings disallowed for this context";

const program = `
import vm from "node:vm";
const seen: Record<string, string> = {};
function attempt(name: string, make: () => unknown) {
  try {
    seen[name] = String(make());
  } catch (error) {
    seen[name] = String(error);
  }
}
attempt("eval", () => eval("1 + 1"));
attempt("indirect eval", () => (0, eval)("1 + 1"));
attempt("Function", () => Function("return 2")());
attempt("new Function", () => new Function("return 2")());
attempt("the constructor of a function", () => function () {}.constructor("return 2")());
attempt("the constructor of an async function", () => typeof async function () {}.constructor("return 2"));
attempt("the constructor of a generator function", () => typeof function* () {}.constructor("yield 2"));
attempt("the constructor of an async generator function", () => typeof async function* () {}.constructor("yield 2"));
attempt("eval of what is no string", () => eval(2 as never));
attempt("node:vm", () => vm.runInNewContext("1 + 1"));
console.log(JSON.stringify({ seen, execArgv: process.execArgv }));
`;

const everyConstructor = {
  "eval": refused,
  "indirect eval": refused,
  "Function": refused,
  "new Function": refused,
  "the constructor of a function": refused,
  "the constructor of an async function": refused,
  "the constructor of a generator function": refused,
  "the constructor of an async generator function": refused,
  "eval of what is no string": "2",
};

const kinds: [string, string[]][] = [["--compile", []]];
if (!unsupported && !isWindows) kinds.push(["--compile --aot", ["--aot"]]);
if (!unsupported && !isWindows && canTrim) kinds.push(["--compile --aot --trim", ["--aot", "--trim"]]);

describe.concurrent("bun build --compile --disallow-code-generation-from-strings", () => {
  describe.each(kinds)("%s", (_, more) => {
    test.each([
      [flag, { ...everyConstructor, "node:vm": "2" }],
      [flag + "=strict", { ...everyConstructor, "node:vm": refused }],
    ])("%s", async (given, seen) => {
      using dir = tempDir("compile-disallow-code-generation", { "app.ts": program });
      const built = await run(
        [bunExe(), "build", "--compile", ...more, given, "app.ts", "--outfile", "app"],
        String(dir),
      );
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });
      const ran = await run([join(String(dir), "app")], String(dir));
      expect({ said: JSON.parse(ran.stdout), stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
        said: { seen, execArgv: [given] },
        stderr: "",
        exitCode: 0,
      });
    });

    test("without the flag nothing is refused", async () => {
      using dir = tempDir("compile-disallow-code-generation", { "app.ts": program });
      const built = await run([bunExe(), "build", "--compile", ...more, "app.ts", "--outfile", "app"], String(dir));
      expect(built.exitCode).toBe(0);
      const ran = await run([join(String(dir), "app")], String(dir));
      expect(Object.values(JSON.parse(ran.stdout).seen).filter(said => String(said).includes("EvalError"))).toEqual([]);
    });
  });

  test("it stands in front of what --compile-exec-argv gives", async () => {
    using dir = tempDir("compile-disallow-code-generation", {
      "app.ts": `console.log(JSON.stringify(process.execArgv));`,
    });
    const built = await run(
      [bunExe(), "build", "--compile", flag, "--compile-exec-argv=--smol", "app.ts", "--outfile", "app"],
      String(dir),
    );
    expect(built.exitCode).toBe(0);
    expect((await run([join(String(dir), "app")], String(dir))).stdout).toBe(JSON.stringify([flag, "--smol"]) + "\n");
  });

  test.each([
    [true, flag],
    ["strict", flag + "=strict"],
  ] as const)("Bun.build({ compile: { disallowCodeGenerationFromStrings: %j } })", async (level, given) => {
    using dir = tempDir("compile-disallow-code-generation", {
      "app.ts": program,
      "build.ts": `
        const built = await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./app", disallowCodeGenerationFromStrings: ${JSON.stringify(level)} } });
        if (!built.success) throw new AggregateError(built.logs);
      `,
    });
    const built = await run([bunExe(), "build.ts"], String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const said = JSON.parse((await run([join(String(dir), "app")], String(dir))).stdout);
    expect({ eval: said.seen.eval, execArgv: said.execArgv }).toEqual({ eval: refused, execArgv: [given] });
  });

  test("in Bun.build too it stands in front of execArgv", async () => {
    using dir = tempDir("compile-disallow-code-generation", {
      "app.ts": `console.log(JSON.stringify(process.execArgv));`,
      "build.ts": `
        const built = await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./app", execArgv: ["--smol"], disallowCodeGenerationFromStrings: true } });
        if (!built.success) throw new AggregateError(built.logs);
      `,
    });
    expect((await run([bunExe(), "build.ts"], String(dir))).exitCode).toBe(0);
    expect((await run([join(String(dir), "app")], String(dir))).stdout).toBe(JSON.stringify([flag, "--smol"]) + "\n");
  });

  test("Bun.build refuses another value", async () => {
    using dir = tempDir("compile-disallow-code-generation", { "app.ts": program });
    expect(
      async () =>
        await Bun.build({
          entrypoints: [join(String(dir), "app.ts")],
          compile: { outfile: join(String(dir), "app"), disallowCodeGenerationFromStrings: "strcit" as never },
        }),
    ).toThrow('disallowCodeGenerationFromStrings must be a boolean or "strict"');
  });

  test("it requires --compile", async () => {
    using dir = tempDir("compile-disallow-code-generation", { "app.ts": program });
    const built = await run([bunExe(), "build", flag, "app.ts", "--outdir", "out"], String(dir));
    expect({ stderr: built.stderr.trim(), isRefused: built.exitCode !== 0 }).toEqual({
      stderr: `error: ${flag} requires --compile`,
      isRefused: true,
    });
  });

  test("another value is refused", async () => {
    using dir = tempDir("compile-disallow-code-generation", { "app.ts": program });
    const built = await run(
      [bunExe(), "build", "--compile", flag + "=strcit", "app.ts", "--outfile", "app"],
      String(dir),
    );
    expect({ stderr: built.stderr.trim(), exitCode: built.exitCode }).toEqual({
      stderr: `error: Invalid value for ${flag}: "strcit". Must be "strict", or no value`,
      exitCode: 1,
    });
  });
});
