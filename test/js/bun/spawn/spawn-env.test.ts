import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { join } from "node:path";

test("spawn env", async () => {
  const env = {};
  Object.defineProperty(env, "LOL", {
    get() {
      throw new Error("Bad!!");
    },
    configurable: false,
    enumerable: true,
  });

  // This was the minimum to reliably cause a crash in Bun < v1.1.42
  for (let i = 0; i < 1024 * 10; i++) {
    try {
      const result = spawn({
        env,
        cmd: [bunExe(), "-e", "console.log(process.env.LOL)"],
      });
    } catch (e) {}
  }
});

// Prints, as one JSON object, every variable of the child whose name is `name`
// in any casing, so the test sees both which spelling the child got and its value.
function printVariable(name: string) {
  const upper = JSON.stringify(name.toUpperCase());
  return `console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() === ${upper}))))`;
}

type Env = Record<string, string | undefined>;

// bunEnv without the parent's own PATH entry (spelled `Path` or `PATH` depending
// on what launched the test), so each case below controls every PATH spelling.
const envWithoutPath: Env = Object.fromEntries(Object.entries(bunEnv).filter(([k]) => k.toUpperCase() !== "PATH"));

async function variableViaSpawn(name: string, env: Env) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", printVariable(name)],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

function variableViaSpawnSync(name: string, env: Env) {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", printVariable(name)],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.toString());
}

function variableViaChildProcess(name: string, env: Env) {
  const { stdout, stderr, status } = nodeSpawnSync(bunExe(), ["-e", printVariable(name)], { env, encoding: "utf8" });
  expect(stderr).toBe("");
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

describe.skipIf(!isWindows)("env names are case-insensitive on Windows", () => {
  // Same rule as node's child_process (normalizeSpawnArguments): of the keys
  // that differ only in case, the lexicographically first one (so the upper
  // case spelling) is passed to the child, whatever order they were added in.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L715-L738
  const cases: [name: string, env: Env, variable: string, expected: Env][] = [
    [
      "{ ...process.env, PATH } overrides the parent's Path",
      { ...envWithoutPath, Path: "C:\\from-parent", PATH: "C:\\override" },
      "PATH",
      { PATH: "C:\\override" },
    ],
    [
      "{ PATH, Path }: PATH still wins when added first",
      { ...envWithoutPath, PATH: "C:\\override", Path: "C:\\from-parent" },
      "PATH",
      { PATH: "C:\\override" },
    ],
    [
      "{ Spawn_Env_Case, SPAWN_ENV_CASE }: upper case wins",
      { ...bunEnv, Spawn_Env_Case: "mixed", SPAWN_ENV_CASE: "upper" },
      "SPAWN_ENV_CASE",
      { SPAWN_ENV_CASE: "upper" },
    ],
    [
      "{ SPAWN_ENV_CASE, Spawn_Env_Case }: upper case wins when added first",
      { ...bunEnv, SPAWN_ENV_CASE: "upper", Spawn_Env_Case: "mixed" },
      "SPAWN_ENV_CASE",
      { SPAWN_ENV_CASE: "upper" },
    ],
    [
      "{ spawn_env_case, Spawn_Env_Case }: mixed case beats lower case",
      { ...bunEnv, spawn_env_case: "lower", Spawn_Env_Case: "mixed" },
      "SPAWN_ENV_CASE",
      { Spawn_Env_Case: "mixed" },
    ],
    [
      "{ Spawn_Env_Case, SPAWN_ENV_CASE: undefined } removes the variable",
      { ...bunEnv, Spawn_Env_Case: "mixed", SPAWN_ENV_CASE: undefined },
      "SPAWN_ENV_CASE",
      {},
    ],
    [
      "{ SPAWN_ENV_CASE, spawn_env_case: undefined } keeps the upper case one",
      { ...bunEnv, SPAWN_ENV_CASE: "upper", spawn_env_case: undefined },
      "SPAWN_ENV_CASE",
      { SPAWN_ENV_CASE: "upper" },
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, env, variable, expected) => {
    expect({
      spawn: await variableViaSpawn(variable, env),
      spawnSync: variableViaSpawnSync(variable, env),
      childProcess: variableViaChildProcess(variable, env),
    }).toEqual({ spawn: expected, spawnSync: expected, childProcess: expected });
  });

  // The PATH entry that wins is also the one the executable is looked up in.
  // The tool is a batch file: cmd.exe re-resolves its name through the child's
  // own PATH, so this only runs if the child received the winning entry too.
  const lookupCases: [name: string, env: (withTool: string, withoutTool: string) => Env][] = [
    [
      "{ Path: without the tool, PATH: with the tool }",
      (withTool, withoutTool) => ({ Path: withoutTool, PATH: withTool }),
    ],
    [
      "{ PATH: with the tool, Path: without the tool }",
      (withTool, withoutTool) => ({ PATH: withTool, Path: withoutTool }),
    ],
  ];

  test.concurrent.each(lookupCases)("executable is looked up in the winning PATH: %s", async (_name, pathEntries) => {
    using dir = tempDir("spawn-env-path", {
      "with-tool/spawn-env-tool.cmd": "@echo off\r\necho TOOL_RAN\r\n",
      "without-tool/.keep": "",
    });
    await using proc = Bun.spawn({
      cmd: ["spawn-env-tool"],
      env: { ...envWithoutPath, ...pathEntries(join(String(dir), "with-tool"), join(String(dir), "without-tool")) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "TOOL_RAN", stderr: "", exitCode: 0 });
  });
});

test.skipIf(isWindows)("env names that differ only in case are distinct variables on POSIX", async () => {
  const env = { ...bunEnv, Path: "C:\\from-parent", PATH: "C:\\override" };
  const expected = { Path: "C:\\from-parent", PATH: "C:\\override" };
  expect({
    spawn: await variableViaSpawn("PATH", env),
    spawnSync: variableViaSpawnSync("PATH", env),
    childProcess: variableViaChildProcess("PATH", env),
  }).toEqual({ spawn: expected, spawnSync: expected, childProcess: expected });
});
