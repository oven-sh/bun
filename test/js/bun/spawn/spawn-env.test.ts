import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

describe.skipIf(!isWindows)("env names are case-insensitive on Windows", () => {
  // Of the properties whose names differ only in case, the last one is what the
  // child gets, as with every other env object in bun on Windows. Properties set
  // to undefined are skipped before that, as on POSIX, so the usual way of
  // clearing every spelling and then setting one works whichever spelling is set
  // (a `[key]: value` after the undefined ones lands wherever that key already
  // was, see the scheme cases in test/js/bun/http/proxy.test.ts).
  // node:child_process keeps node's own rule, applied in JS before Bun.spawn.
  const cases: [name: string, env: Env, variable: string, expected: Env][] = [
    [
      "{ ...process.env, PATH } overrides the parent's Path",
      { ...envWithoutPath, Path: "C:\\from-parent", PATH: "C:\\override" },
      "PATH",
      { PATH: "C:\\override" },
    ],
    [
      "{ ...env, path } overrides an upper case PATH",
      { ...envWithoutPath, PATH: "C:\\from-parent", path: "C:\\override" },
      "PATH",
      { path: "C:\\override" },
    ],
    [
      "{ ...env, spawn_env_case } overrides an inherited SPAWN_ENV_CASE (the http_proxy over HTTP_PROXY shape)",
      { ...bunEnv, SPAWN_ENV_CASE: "inherited", spawn_env_case: "override" },
      "SPAWN_ENV_CASE",
      { spawn_env_case: "override" },
    ],
    [
      "{ Spawn_Env_Case, SPAWN_ENV_CASE }: the later one wins",
      { ...bunEnv, Spawn_Env_Case: "first", SPAWN_ENV_CASE: "second" },
      "SPAWN_ENV_CASE",
      { SPAWN_ENV_CASE: "second" },
    ],
    [
      "{ SPAWN_ENV_CASE, Spawn_Env_Case }: the later one wins",
      { ...bunEnv, SPAWN_ENV_CASE: "first", Spawn_Env_Case: "second" },
      "SPAWN_ENV_CASE",
      { Spawn_Env_Case: "second" },
    ],
    [
      "{ SPAWN_ENV_CASE: undefined, spawn_env_case: set }: the set spelling is passed",
      { ...bunEnv, SPAWN_ENV_CASE: undefined, spawn_env_case: "set" },
      "SPAWN_ENV_CASE",
      { spawn_env_case: "set" },
    ],
    [
      "{ SPAWN_ENV_CASE: set, spawn_env_case: undefined }: the set spelling is passed",
      { ...bunEnv, SPAWN_ENV_CASE: "set", spawn_env_case: undefined },
      "SPAWN_ENV_CASE",
      { SPAWN_ENV_CASE: "set" },
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, env, variable, expected) => {
    expect(await variableViaSpawn(variable, env)).toEqual(expected);
  });

  test("Bun.spawnSync applies the same rule", () => {
    const [, env, variable, expected] = cases[0];
    expect(variableViaSpawnSync(variable, env)).toEqual(expected);
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
      "{ PATH: without the tool, Path: with the tool }",
      (withTool, withoutTool) => ({ PATH: withoutTool, Path: withTool }),
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
  const env = {
    ...bunEnv,
    Path: "C:\\from-parent",
    PATH: "C:\\override",
    Spawn_Env_Case: "kept",
    SPAWN_ENV_CASE: undefined,
  };
  const expected = [{ Path: "C:\\from-parent", PATH: "C:\\override" }, { Spawn_Env_Case: "kept" }];
  expect({
    spawn: await Promise.all([variableViaSpawn("PATH", env), variableViaSpawn("SPAWN_ENV_CASE", env)]),
    spawnSync: [variableViaSpawnSync("PATH", env), variableViaSpawnSync("SPAWN_ENV_CASE", env)],
  }).toEqual({ spawn: expected, spawnSync: expected });
});
