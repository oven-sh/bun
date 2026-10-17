import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const files = {
  "app.ts": "console.log(1);\n",
  "app.order": "",
  "package.json": JSON.stringify({ name: "app", type: "module" }),
};

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const unsupported = /^error: --aot: |^compile\.aot: /m;

describe.concurrent("an option that configures bytecode is an error with --aot", () => {
  test.each([
    ["--bytecode-depth=1", "--bytecode-depth"],
    ["--bytecode-order=app.order", "--bytecode-order"],
  ])("bun build --compile --aot %s", async (flag, name) => {
    using dir = tempDir("aot-bytecode-flag", files);
    const { stdout, stderr, exitCode } = await bun(String(dir), "build", "--compile", "--aot", flag, "app.ts", "--outfile", "out");
    if (unsupported.test(stderr)) return;
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: `error: --aot does not support ${name}\n`, exitCode: 1 });
    expect(existsSync(join(String(dir), isWindows ? "out.exe" : "out"))).toBe(false);
  });

  test.each([
    ["bytecodeDepth: 1", "", "bytecodeDepth"],
    ["", 'bytecodeOrder: "./app.order"', "compile.bytecodeOrder"],
  ])("Bun.build: %s %s", async (option, ofCompile, name) => {
    using dir = tempDir("aot-bytecode-option", {
      ...files,
      "build.ts": `try {
  await Bun.build({ entrypoints: ["./app.ts"], ${option}${option && ","} compile: { outfile: "./out", aot: true, ${ofCompile} } });
  console.log("built");
} catch (error) {
  console.log((error as Error).message);
}
`,
    });
    const { stdout } = await bun(String(dir), "build.ts");
    if (unsupported.test(stdout)) return;
    expect(stdout).toBe(`compile.aot does not support ${name}\n`);
  });

  test("--bytecode is implied by --aot and may be combined with it", async () => {
    using dir = tempDir("aot-with-bytecode", files);
    const { stderr, exitCode } = await bun(String(dir), "build", "--compile", "--aot", "--bytecode", "app.ts", "--outfile", "out");
    if (unsupported.test(stderr)) return;
    expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
  }, 60_000);

  test("without --aot they are accepted as before", async () => {
    using dir = tempDir("bytecode-flags-without-aot", files);
    const { stderr, exitCode } = await bun(String(dir), "build", "--compile", "--bytecode", "--format=esm", "--bytecode-depth=1", "app.ts", "--outfile", "out");
    expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
  }, 60_000);
});
