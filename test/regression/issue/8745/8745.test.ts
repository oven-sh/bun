import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { readdirSync } from "fs";

const expected_stdout = new TextDecoder().decode(
  new Uint8Array([195, 166, 226, 132, 162, 229, 188, 159, 230, 176, 151, 240, 159, 145, 139]),
);
const fixture = `console.log(String.raw\`æ™弟気👋\`);`;
const dir = tempDirWithFiles("run directly", {
  "fixture.ts": fixture,
  "requires_rtc_fixture.ts": fixture + " ".repeat(16 * 1024 * 1024),
});

test("run directly", async () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "fixture.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect({
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  }).toEqual({
    stdout: expected_stdout,
    stderr: "",
    exitCode: 0,
  });
});

test("build js then run", async () => {
  const result_built = Bun.spawnSync({
    cmd: [bunExe(), "build", "--target", "bun", "--outfile", "build/fixture.js", "fixture.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result_built.exitCode).toBe(0);

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build/fixture.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect({
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  }).toEqual({
    stdout: expected_stdout,
    stderr: "",
    exitCode: 0,
  });
});

test("build exe then run", async () => {
  const result_built = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--target", "bun", "--outfile", "build/fixture_exe", "fixture.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result_built.exitCode).toBe(0);

  const result = Bun.spawnSync({
    cmd: ["build/fixture_exe"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect({
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  }).toEqual({
    stdout: expected_stdout,
    stderr: "",
    exitCode: 0,
  });
});

// run (using runtime transpiler cache)
test("run (using runtime transpiler cache)", async () => {
  // first time to make the cache and second time to use the cache
  for (let i = 0; i < 2; i++) {
    const result = Bun.spawnSync({
      cmd: [bunExe(), "requires_rtc_fixture.ts"],
      cwd: dir,
      env: { ...bunEnv, "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "build/rtc_path" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect({
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
    }).toEqual({
      stdout: expected_stdout,
      stderr: "",
      exitCode: 0,
    });
  }
  const rtc_entries = readdirSync(dir + "/build/rtc_path");
  expect(rtc_entries).toHaveLength(1);
  expect(rtc_entries[0]).toMatch(/^.+?\.pile$/);
});
