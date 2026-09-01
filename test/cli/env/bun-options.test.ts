import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function run(cmd: string[], BUN_OPTIONS: string) {
  await using proc = Bun.spawn({
    cmd,
    env: { ...bunEnv, BUN_OPTIONS },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// CPU.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq>.cpuprofile
const cpuProfileFileName = /^CPU\.\d{8}\.\d{6}\.\d+\.\d+\.\d{3}\.cpuprofile$/;

async function expectOneCpuProfile(dir: string) {
  const files = readdirSync(dir);
  expect(files).toEqual([expect.stringMatching(cpuProfileFileName)]);
  expect(await Bun.file(join(dir, files[0])).json()).toEqual({
    nodes: expect.any(Array),
    startTime: expect.any(Number),
    endTime: expect.any(Number),
    samples: expect.any(Array),
    timeDeltas: expect.any(Array),
  });
}

describe.concurrent("BUN_OPTIONS environment variable", () => {
  test.each([
    {
      name: "passes an option to the bun command",
      BUN_OPTIONS: "--print='BUN_OPTIONS WAS A SUCCESS'",
      argv: [],
      stdout: "BUN_OPTIONS WAS A SUCCESS\n",
    },
    {
      name: "passes every option when a bare flag follows a flag with a value",
      BUN_OPTIONS: "--print=typeof(gc) --expose-gc",
      argv: [],
      stdout: "function\n",
    },
    {
      name: "keeps a double quoted value as one option",
      BUN_OPTIONS: '--print="QUOTED OPTIONS"',
      argv: [],
      stdout: "QUOTED OPTIONS\n",
    },
    {
      name: "puts environment options before command line options, so the command line wins",
      BUN_OPTIONS: "--title=from-env",
      argv: ["--title=from-cli", "--print=process.title"],
      stdout: "from-cli\n",
    },
    {
      name: "an empty value changes nothing",
      BUN_OPTIONS: "",
      argv: ["--print='NORMAL'"],
      stdout: "NORMAL\n",
    },
  ])("$name", async ({ BUN_OPTIONS, argv, stdout }) => {
    expect(await run([bunExe(), ...argv], BUN_OPTIONS)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test("a bare flag before a flag with a value keeps no trailing whitespace", async () => {
    // Before #26464 the parser received "--expose-gc " and skipped it as an unknown flag.
    const code = "console.log(JSON.stringify(process.execArgv), typeof gc, process.title)";
    expect(await run([bunExe(), "-e", code], "--expose-gc --title=bun-options-test")).toEqual({
      stdout: `${JSON.stringify(["--expose-gc", "--title=bun-options-test", "-e", code])} function bun-options-test\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("--cpu-prof before --cpu-prof-dir writes one profile", async () => {
    using dir = tempDir("bun-options-cpu-prof", {});

    expect(await run([bunExe(), "-e", "1"], `--cpu-prof --cpu-prof-dir=${dir}`)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    await expectOneCpuProfile(String(dir));
  });

  test("--cpu-prof before --cpu-prof-dir writes one profile (standalone executable)", async () => {
    using dir = tempDir("bun-options-cpu-prof-compile", {
      "entry.ts": "console.log(JSON.stringify(process.execArgv));",
    });
    const exePath = join(String(dir), "app");
    const profDir = join(String(dir), "profiles");

    const build = await run([bunExe(), "build", "--compile", join(String(dir), "entry.ts"), "--outfile", exePath], "");
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);

    expect(await run([exePath], `--cpu-prof --cpu-prof-dir=${profDir}`)).toEqual({
      stdout: `${JSON.stringify(["--cpu-prof", `--cpu-prof-dir=${profDir}`])}\n`,
      stderr: "",
      exitCode: 0,
    });
    await expectOneCpuProfile(profDir);
  });
});
