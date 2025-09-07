import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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

test("build min js then run", async () => {
  const result_built = Bun.spawnSync({
    cmd: [bunExe(), "build", "--target", "bun", "--minify", "--outfile", "build/fixture-min.js", "fixture.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result_built.exitCode).toBe(0);

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build/fixture-min.js"],
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

// It's not clear what the cutoff is to the runtime transpiler cache
// https://github.com/oven-sh/bun/blob/b960677f5f99de7adf7b84fb8b4c8e1a97ff9e55/src/bun.js/RuntimeTranspilerCache.zig#L17
test("run directly (requires rtc)", async () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "requires_rtc_fixture.ts"],
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

test("build js then run (requires rtc)", async () => {
  const result_built = Bun.spawnSync({
    cmd: [
      bunExe(),
      "build",
      "--target",
      "bun",
      "--outfile",
      "build/requires_rtc_fixture.js",
      "requires_rtc_fixture.ts",
    ],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result_built.exitCode).toBe(0);

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build/requires_rtc_fixture.js"],
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

test("build min js then run (requires rtc)", async () => {
  const result_built = Bun.spawnSync({
    cmd: [
      bunExe(),
      "build",
      "--target",
      "bun",
      "--minify",
      "--outfile",
      "build/requires_rtc_fixture-min.js",
      "requires_rtc_fixture.ts",
    ],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result_built.exitCode).toBe(0);

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build/requires_rtc_fixture-min.js"],
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
