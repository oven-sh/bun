import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const files = {
  "app.ts": "console.log(JSON.stringify(process.argv.slice(2)));\n",
  "app.test.ts": 'import { test } from "bun:test";\ntest("runs", () => {});\n',
  "package.json": JSON.stringify({ name: "app", type: "module", scripts: { show: `"${bunExe()}" app.ts` } }),
};

async function bun(cwd: string | { cwd: string; BUN_OPTIONS: string }, ...args: string[]) {
  const { cwd: folder, ...env } = typeof cwd === "string" ? { cwd } : cwd;
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd: folder, env: { ...bunEnv, NO_COLOR: "1", ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const ofBuild = "--aot, --aot-explain, --aot-type-errors";
const ofRun = "--aot, --aot-audit, --aot-type-errors";

describe.concurrent("a flag that starts with --aot and does not exist is an error", () => {
  test.each([
    [["build", "--compile", "--aot", "--aot-type-error=log", "app.ts", "--outfile", "out"], "--aot-type-error", "--aot-type-errors", ofBuild],
    [["build", "--compile", "--aot", "--aot-type-errors-log", "app.ts", "--outfile", "out"], "--aot-type-errors-log", "--aot-type-errors", ofBuild],
    [["build", "--compile", "--aot", "--aot-explains=throws", "app.ts", "--outfile", "out"], "--aot-explains", "--aot-explain", ofBuild],
    [["build", "--compile", "--aott", "app.ts", "--outfile", "out"], "--aott", "--aot", ofBuild],
    [["build", "--compile", "app.ts", "--outfile", "out", "--aot-"], "--aot-", "--aot", ofBuild],
    [["build", "--compile", "--aot-audit", "app.ts", "--outfile", "out"], "--aot-audit", "bun run and bun test", ofBuild],
    [["--aot-audits", "app.ts"], "--aot-audits", "--aot-audit", ofRun],
    [["--aot-type-error=log", "--aot", "app.ts"], "--aot-type-error", "--aot-type-errors", ofRun],
    [["run", "--aott", "app.ts"], "--aott", "--aot", ofRun],
    [["run", "--aot-explain=throws", "app.ts"], "--aot-explain", "bun build", ofRun],
    [["test", "--aot-nothing-like-it"], "--aot-nothing-like-it", null, ofRun],
    [["test", "--aott"], "--aott", "--aot", ofRun],
    [["test", "app.test.ts", "--aot-type-error=log"], "--aot-type-error", "--aot-type-errors", ofRun],
  ])("bun %j", async (args, written, meant, all) => {
    using dir = tempDir("aot-unknown-flag", files);
    const { stdout, stderr, exitCode } = await bun(String(dir), ...args);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${meant?.startsWith("bun ") ? `${written} is a flag of ${meant}.` : `unknown flag ${written}.${meant ? ` Did you mean ${meant}?` : ""}`} The flags that start with --aot here are ${all}\n`,
      exitCode: 1,
    });
    expect(existsSync(join(String(dir), isWindows ? "out.exe" : "out"))).toBe(false);
  });

  test.each([
    [["app.ts", "--aot-mine", "--aott=1"]],
    [["run", "app.ts", "--aot-mine", "--aott=1"]],
    [["run", "app.ts", "--", "--aot-mine", "--aott=1"]],
    [["run", "show", "--aot-mine", "--aott=1"]],
  ])("what follows the script is the script's: bun %j", async args => {
    using dir = tempDir("aot-flags-of-the-script", files);
    const { stdout, exitCode } = await bun(String(dir), ...args);
    expect({ passed: JSON.parse(stdout).filter((arg: string) => arg !== "--"), exitCode }).toEqual({ passed: ["--aot-mine", "--aott=1"], exitCode: 0 });
  });

  test("the arguments of a compiled executable are the program's", async () => {
    using dir = tempDir("aot-flags-of-the-executable", files);
    expect((await bun(String(dir), "build", "--compile", "app.ts", "--outfile", "out")).exitCode).toBe(0);
    await using proc = Bun.spawn({ cmd: [join(String(dir), isWindows ? "out.exe" : "out"), "--aot-mine", "--aott=1"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    expect([await proc.stdout.text(), await proc.exited]).toEqual(['["--aot-mine","--aott=1"]\n', 0]);
  }, 60_000);

  test("BUN_OPTIONS is read by every command: a flag of another command is passed over, a flag of none is not", async () => {
    using dir = tempDir("aot-flags-in-bun-options", files);
    const cwd = String(dir);
    expect((await bun({ cwd, BUN_OPTIONS: "--aot-explain=throws" }, "app.ts")).stdout).toBe("[]\n");
    expect((await bun({ cwd, BUN_OPTIONS: "--aot-audit" }, "build", "app.ts", "--outfile", "out.js")).exitCode).toBe(0);
    expect(await bun({ cwd, BUN_OPTIONS: "--aott" }, "app.ts")).toEqual({
      stdout: "",
      stderr: `error: unknown flag --aott. Did you mean --aot? The flags that start with --aot here are ${ofRun}\n`,
      exitCode: 1,
    });
  });

  test("another unknown flag is skipped, as before", async () => {
    using dir = tempDir("aot-other-unknown-flags", files);
    expect(await bun(String(dir), "--never-a-flag", "app.ts")).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["aotTypeError", '"log"', "aotTypeErrors"],
    ["aotExplains", '"throws"', "aotExplain"],
    ["aott", "true", "aot"],
    ["aot_type_errors", '"log"', "aotTypeErrors"],
    ["aotSomethingElse", "1", null],
  ])("Bun.build: compile.%s", async (key, value, meant) => {
    using dir = tempDir("aot-unknown-option", {
      ...files,
      "build.ts": `try {
  await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./out", ${key}: ${value} } as any });
  console.log("built");
} catch (error) {
  console.log((error as Error).message);
}
`,
    });
    expect((await bun(String(dir), "build.ts")).stdout).toBe(
      `compile.${key} is not an option.${meant ? ` Did you mean compile.${meant}?` : ""} The options that start with aot are aot, aotExplain, aotTypeErrors\n`,
    );
  });
});
