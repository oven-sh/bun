import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "../aot/harness/run";

const files = {
  "app.ts": "console.log(JSON.stringify(process.argv.slice(2)));\n",
  "app.test.ts": 'import { test } from "bun:test";\ntest("runs", () => {});\n',
  "package.json": JSON.stringify({ name: "app", type: "module", scripts: { show: `"${bunExe()}" app.ts` } }),
};

async function bun(cwd: string | { cwd: string; BUN_OPTIONS: string }, ...args: string[]) {
  const { cwd: folder, ...env } = typeof cwd === "string" ? { cwd } : cwd;
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], folder, { ...bunEnv, NO_COLOR: "1", ...env });
  return { stdout, stderr, exitCode };
}

const ofBuild = "--aot, --aot-allow-code-from-disk, --aot-huge-heap, --aot-log-type-mismatches";
const ofRun = "--aot, --aot-log-type-mismatches";

describe.concurrent("an unknown flag that starts with --aot is an error", () => {
  test.each([
    [
      ["build", "--compile", "--aot", "--aot-log-type-mismatch", "app.ts", "--outfile", "out"],
      "--aot-log-type-mismatch",
      "--aot-log-type-mismatches",
      ofBuild,
    ],
    [
      ["build", "--compile", "--aot", "--aot-type-errors=log", "app.ts", "--outfile", "out"],
      "--aot-type-errors",
      null,
      ofBuild,
    ],
    [["build", "--compile", "--aott", "app.ts", "--outfile", "out"], "--aott", "--aot", ofBuild],
    [["build", "--compile", "app.ts", "--outfile", "out", "--aot-"], "--aot-", "--aot", ofBuild],
    [
      ["build", "--compile", "--aot-graph-fd=7", "app.ts", "--outfile", "out"],
      "--aot-graph-fd",
      "bun run and bun test",
      ofBuild,
    ],
    [["--aot-log-type-mismatch", "app.ts"], "--aot-log-type-mismatch", "--aot-log-type-mismatches", ofRun],
    [["run", "--aot", "--aot-type-errors=log", "app.ts"], "--aot-type-errors", null, ofRun],
    [["run", "--aott", "app.ts"], "--aott", "--aot", ofRun],
    [["test", "--aot-nothing-like-it"], "--aot-nothing-like-it", null, ofRun],
    [["test", "--aott"], "--aott", "--aot", ofRun],
    [["test", "app.test.ts", "--aot-type-errors=log"], "--aot-type-errors", null, ofRun],
    [["--aot-stamp"], "--aot-stamp", null, ofRun],
    [
      ["build", "--compile", "--aot", "--aot-disabled=flow-results", "app.ts", "--outfile", "out"],
      "--aot-disabled",
      null,
      ofBuild,
    ],
    [["run", "--aot", "--aot-validate", "app.ts"], "--aot-validate", "bun build", ofRun],
  ])("bun %j", async (args, written, meant, all) => {
    using dir = tempDir("aot-unknown-flag", files);
    const { stdout, stderr, exitCode } = await bun(String(dir), ...args);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${meant?.startsWith("bun ") ? `${written} is only valid with ${meant}.` : `unknown flag ${written}.${meant ? ` Did you mean ${meant}?` : ""}`} The --aot flags for this command are ${all}\n`,
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
    expect({ passed: JSON.parse(stdout).filter((arg: string) => arg !== "--"), exitCode }).toEqual({
      passed: ["--aot-mine", "--aott=1"],
      exitCode: 0,
    });
  });

  test("a compiled executable's arguments belong to the program", async () => {
    using dir = tempDir("aot-flags-of-the-executable", files);
    expect((await bun(String(dir), "build", "--compile", "app.ts", "--outfile", "out")).exitCode).toBe(0);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), isWindows ? "out.exe" : "out"), "--aot-mine", "--aott=1"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await proc.stdout.text(), await proc.exited]).toEqual(['["--aot-mine","--aott=1"]\n', 0]);
  }, 60_000);

  test("BUN_OPTIONS is read by every command: a flag of another command is ignored, a flag of no command is an error", async () => {
    using dir = tempDir("aot-flags-in-bun-options", files);
    const cwd = String(dir);
    expect((await bun({ cwd, BUN_OPTIONS: "--explain=guards" }, "app.ts")).stdout).toBe("[]\n");
    expect(
      (await bun({ cwd, BUN_OPTIONS: "--aot-decode-crash-report=x" }, "build", "app.ts", "--outfile", "out.js"))
        .exitCode,
    ).toBe(0);
    expect(await bun({ cwd, BUN_OPTIONS: "--aott" }, "app.ts")).toEqual({
      stdout: "",
      stderr: `error: unknown flag --aott. Did you mean --aot? The --aot flags for this command are ${ofRun}\n`,
      exitCode: 1,
    });
  });

  test("other unknown flags are still ignored", async () => {
    using dir = tempDir("aot-other-unknown-flags", files);
    expect(await bun(String(dir), "--never-a-flag", "app.ts")).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["aotLogTypeMismatch", "true", "aotLogTypeMismatches"],
    ["aotExplains", '"guards"', "aotExplain"],
    ["aott", "true", "aot"],
    ["aot_log_type_mismatches", "true", "aotLogTypeMismatches"],
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
      `compile.${key} is not a valid option.${meant ? ` Did you mean compile.${meant}?` : ""} Options that start with "aot": aot, aotExplain, aotLogTypeMismatches\n`,
    );
  });

  test.each([
    ["aot", "true", '{ outfile: "./out" }'],
    ["aot", "false", "true"],
    ["aotLogTypeMismatches", "true", '{ outfile: "./out", aot: true }'],
    ["aotExplain", '"guards"', "undefined"],
  ])("Bun.build: %s: %s beside compile: %s", async (key, value, compile) => {
    using dir = tempDir("aot-option-beside-compile", {
      ...files,
      "build.ts": `try {
  await Bun.build({ entrypoints: ["./app.ts"], compile: ${compile}, ${key}: ${value} } as any);
  console.log("built");
} catch (error) {
  console.log((error as Error).message);
}
`,
    });
    expect((await bun(String(dir), "build.ts")).stdout).toBe(
      `"${key}" goes inside compile. Write compile: { ${key}: ... }\n`,
    );
  });
});
