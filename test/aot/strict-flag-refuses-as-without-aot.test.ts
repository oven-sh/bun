// `--disallow-code-generation-from-strings=strict` in an executable: whatever would turn a string or a file on the disk into
// code ends in the flag's own error, an EvalError with one text. An executable built with --aot refuses code from the disk
// anyway, in words of its own. Where the flag is set it says what the flag says, so the two builds print the same.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

setDefaultTimeout(240_000);

const refusal = "EvalError: Code generation from strings disallowed for this context";
const files = {
  "main.ts": `import { createRequire } from "node:module";
import * as vm from "node:vm";
const onDisk = process.cwd() + "/disk.js";
const data = process.cwd() + "/data.json";
// A constant text is compiled when the executable is built. This one is made when the program runs.
const made = (text: string) => text + " ".repeat(Number(process.argv.length > 99));
const roads: [string, () => unknown][] = [
  ["eval", () => (0, eval)(made("1 + 1"))],
  ["direct eval", () => eval(made("1 + 1"))],
  ["Function", () => new Function(made("return 2"))()],
  ["vm.Script", () => new vm.Script(made("2"))],
  ["vm.runInNewContext", () => vm.runInNewContext(made("2"))],
  ["require of code on the disk", () => createRequire(import.meta.url)(onDisk)],
  ["import.meta.require of code on the disk", () => import.meta.require(onDisk)],
  ["import() of code on the disk", () => import(onDisk)],
  ["require of data on the disk", () => createRequire(import.meta.url)(data).kind],
  ["require of a file that is not there", () => createRequire(import.meta.url)(onDisk + ".absent.js")],
];
for (const [name, run] of roads) {
  try {
    console.log(name, "=>", String(await run()));
  } catch (error) {
    const { name: kind, message, code } = error as Error & { code?: string };
    console.log(name, "=>", kind + ": " + message.split("\\n")[0].replaceAll(process.cwd(), "<cwd>"), code);
  }
}
`,
  "disk.js": `console.log("disk.js ran");\nmodule.exports = 5;\n`,
  "data.json": `{ "kind": "data" }\n`,
  "before.js": `console.log("before.js ran");\n`,
};
const named = (name: string) => (isWindows ? name + ".exe" : name);
const strict = "--disallow-code-generation-from-strings=strict";

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1", ...env });
  return { stdout, stderr, exitCode };
}

describe.each([
  ["in the executable's own arguments", ["--compile-exec-argv=" + strict], ""],
  ["in BUN_OPTIONS", [], strict + " "],
])("the flag %s", (_, buildFlags, options) => {
  let dir: ReturnType<typeof tempDir>;
  let cwd: string;
  beforeAll(async () => {
    dir = tempDir("aot-strict-flag", files);
    cwd = String(dir);
    for (const [outfile, flags] of [
      ["without", []],
      ["with", ["--aot"]],
    ] as const) {
      const built = await run(
        [bunExe(), "build", "--compile", ...flags, ...buildFlags, "main.ts", "--outfile", named(outfile)],
        cwd,
      );
      expect(built.stderr).not.toMatch(/^error\b/m);
      expect(built.exitCode).toBe(0);
    }
  });
  const both = async (env: Record<string, string>) => ({
    without: await run([join(cwd, named("without"))], cwd, env),
    with: await run([join(cwd, named("with"))], cwd, env),
  });

  test("every road from a string or a file on the disk to code", async () => {
    const ran = await both(options ? { BUN_OPTIONS: options.trim() } : {});
    expect(ran.with).toEqual(ran.without);
    const lines = ran.with.stdout.split("\n");
    for (const road of ["require", "import.meta.require", "import()"])
      expect(lines).toContain(`${road} of code on the disk => ${refusal} undefined`);
    expect(lines).toContain("require of data on the disk => data");
    expect(ran.with.stdout).not.toContain("disk.js ran");
  });

  test.each([
    "--preload=./before.js",
    "--preload ./before.js",
    "-r ./before.js",
    "--require ./before.js",
    "--import ./before.js",
  ])("BUN_OPTIONS=%s", async option => {
    const ran = await both({ BUN_OPTIONS: options + option });
    expect(ran.with).toEqual(ran.without);
    expect(ran.with).toMatchObject({ stdout: "", exitCode: 1 });
    expect(ran.with.stderr.split("\n")[0]).toBe(refusal);
  });

  test("BUN_INSPECT_PRELOAD", async () => {
    const ran = await both({
      BUN_INSPECT_PRELOAD: join(cwd, "before.js"),
      ...(options ? { BUN_OPTIONS: options.trim() } : {}),
    });
    expect(ran.with).toEqual(ran.without);
    expect(ran.with.stderr.split("\n")[0]).toBe(refusal);
  });
});

test("without the flag an executable built with --aot says what to do about it", async () => {
  using dir = tempDir("aot-strict-flag", files);
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", named("app")], cwd);
  expect(built.exitCode).toBe(0);
  const app = join(cwd, named("app"));
  expect((await run([app], cwd)).stdout).toMatch(
    /^require of code on the disk => Error: Cannot load '.*disk\.js': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\. MODULE_NOT_FOUND$/m,
  );
  expect(await run([app], cwd, { BUN_OPTIONS: "--preload ./before.js" })).toEqual({
    stdout: "",
    stderr:
      "error: --preload can't be used with this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n",
    exitCode: 1,
  });
});
