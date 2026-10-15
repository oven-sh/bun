import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-shell", () => {
  test("running a shell script works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "something.sh"), "echo wah");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "something.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    console.log(stderr);
    expect(stdout).toEqual("wah\n");
  });

  test("a shell script expands ${NAME}, ${NAME:-word} and $?", async () => {
    using dir = tempDir("run-shell-params", {
      "params.sh": 'NAME=value\necho ${NAME} "${NAME}"/x ${RUN_SHELL_UNSET:-default}\nfalse\necho $?\n',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "params.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "value value/x default\n1\n", stderr: "", exitCode: 0 });
  });

  // On Windows `bun install` runs a lifecycle script in the Bun shell. On
  // POSIX it uses the system shell, so there this only checks the fixture.
  test("a lifecycle script of bun install expands ${NAME:-word}", async () => {
    using dir = tempDir("run-shell-lifecycle", {
      "package.json": JSON.stringify({
        name: "lifecycle-fixture",
        version: "1.0.0",
        scripts: { postinstall: "echo ${RUN_SHELL_UNSET:-3000} > port.txt" },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const port = await Bun.file(join(String(dir), "port.txt")).text();
    expect({ port: port.trim(), exitCode }).toEqual({ port: "3000", exitCode: 0 });
    expect(stderr).not.toContain("error:");
  });

  describe("bun run --shell=bun expands a parameter in a package.json script", () => {
    const packageJson = JSON.stringify({
      name: "shell-params",
      version: "1.2.3",
      scripts: {
        version: "echo v${npm_package_version}",
        port: "echo --port ${PORT:-3000}",
        prefix: "SHELL_PARAMS_A=${SHELL_PARAMS_B:-c} bun -e 'console.log(process.env.SHELL_PARAMS_A)'",
        status: "false; echo $?",
      },
    });

    test.each([
      ["version", {}, "v1.2.3\n"],
      ["port", {}, "--port 3000\n"],
      ["port", { PORT: "8080" }, "--port 8080\n"],
      ["prefix", {}, "c\n"],
      ["status", {}, "1\n"],
    ])("%s %j", async (script, vars, expected) => {
      using dir = tempDir("run-shell-package-params", { "package.json": packageJson });
      const env = { ...bunEnv, ...vars };
      if (!("PORT" in vars)) delete env.PORT;
      delete env.SHELL_PARAMS_B;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--shell=bun", "--silent", script],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });

  test("invalid syntax reports the error correctly", async () => {
    const dir = tmpdirSync("bun-shell-test-error");
    mkdirSync(dir, { recursive: true });
    const shellScript = `-h)
  echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`;
    await Bun.write(join(dir, "scripts", "script.sh"), shellScript);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "scripts", "script.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stderr = await proc.stderr.text();
    expect(stderr).toBe("error: Failed to run script.sh due to error Unexpected ')'\n");
  });
});

test.skipIf(isWindows)(
  "package script shell interpreter is resolved from the original PATH, not node_modules/.bin",
  async () => {
    // A dependency can place arbitrary executables named "bash"/"sh"/"zsh" into
    // node_modules/.bin via its "bin" field. The interpreter that runs
    // package.json scripts must never be picked up from there.
    const fakeShell = "#!/bin/sh\necho FAKE_SHELL_USED\n";
    using dir = tempDir("run-shell-interpreter", {
      "package.json": JSON.stringify({
        name: "shell-interpreter-fixture",
        version: "1.0.0",
        scripts: {
          "say-hi": "echo real-shell-ran",
        },
      }),
      "node_modules/.bin/bash": fakeShell,
      "node_modules/.bin/sh": fakeShell,
      "node_modules/.bin/zsh": fakeShell,
    });
    for (const name of ["bash", "sh", "zsh"]) {
      chmodSync(join(String(dir), "node_modules", ".bin", name), 0o755);
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "say-hi"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The script must run under a real system shell, not the executables a
    // dependency dropped into node_modules/.bin.
    expect(stdout).not.toContain("FAKE_SHELL_USED");
    expect(stderr).not.toContain("FAKE_SHELL_USED");
    expect(stdout).toContain("real-shell-ran");
    expect(exitCode).toBe(0);
  },
);
