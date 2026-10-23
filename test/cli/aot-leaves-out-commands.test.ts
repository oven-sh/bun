import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

function run(args: string[], cwd: string) {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
}

using probe = tempDir("bun-aot-commands-probe", {});
const isBunAot = run(["lint"], String(probe)).stderr.startsWith("error: bun-aot doesn't include ");

describe.skipIf(!isBunAot)("bun-aot", () => {
  test.each([
    [["lint"], "bun lint"],
    [["fmt"], "bun fmt"],
    [["install"], "bun install, bunx and the rest of the package manager"],
    [["add", "left-pad"], "bun install, bunx and the rest of the package manager"],
    [["x", "left-pad"], "bun install, bunx and the rest of the package manager"],
    [["pm", "ls"], "bun install, bunx and the rest of the package manager"],
    [["repl"], "bun repl"],
    [["create", "left-pad"], "bun create and bun init"],
    [["init", "-y"], "bun create and bun init"],
    [["upgrade"], "bun upgrade"],
  ])("%j: says which command it doesn't have", (args, text) => {
    using dir = tempDir("bun-aot-commands", { "package.json": "{}" });
    expect(run(args, String(dir))).toEqual({
      stdout: "",
      stderr: `error: bun-aot doesn't include ${text}. Run bun instead.\n`,
      exitCode: 70,
    });
  });

  test("runs what bun hands over", () => {
    using dir = tempDir("bun-aot-commands", {
      "main.ts": `console.log("ran" as string);`,
      "typed.ts": `export const one: number = 1;`,
      "main.test.ts": `import { expect, test } from "bun:test";\ntest("one", () => expect(1).toBe(1));`,
    });
    const folder = String(dir);
    expect(run(["run", "main.ts"], folder)).toMatchObject({ stdout: "ran\n", exitCode: 0 });
    expect(run(["check", "typed.ts"], folder)).toMatchObject({ exitCode: 0 });
    expect(run(["test", "main.test.ts"], folder)).toMatchObject({ exitCode: 0 });
    expect(run(["build", "main.ts", "--outdir", "out"], folder)).toMatchObject({ exitCode: 0 });
    expect(run(["build", "--compile", "--aot", "main.ts", "--outfile", "main"], folder)).toMatchObject({ exitCode: 0 });
  }, 240_000);

  test("an executable can't keep a command that bun-aot doesn't have", () => {
    using dir = tempDir("bun-aot-commands", {
      "main.ts": `console.log("ran");`,
      "build.mjs": `try {
  await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: "./main", aot: true, trim: { allow: ["install"] } } });
  console.log("built");
} catch (error) {
  console.log(String(error.message), ...(error.errors ?? []).map(String));
}`,
    });
    const { stdout, stderr } = run(["build.mjs"], String(dir));
    expect(stdout + stderr).toContain(
      "doesn't have bun install, bunx and the rest of the package manager, which this executable needs",
    );
  }, 240_000);
});
