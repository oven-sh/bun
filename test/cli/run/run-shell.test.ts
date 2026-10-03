import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isMusl, isWindows, tempDir, tmpdirSync } from "harness";
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

  // Windows has no RLIMIT_NOFILE. On musl bun raises the hard fd limit at
  // startup, which succeeds as root and defeats the limit set below.
  test.skipIf(isWindows || isMusl)("a failure to start the interpreter reports the full system error", async () => {
    using dir = tempDir("run-shell-emfile", { "hello.sh": "echo hello\n" });

    // Before the shell runs a script it dups stdout and stderr. A hard
    // RLIMIT_NOFILE equal to the number of fds bun holds at that point makes
    // the dup fail with EMFILE. That number depends on the platform and the
    // build (event loop fds, the cwd fd, stdin), so scan upward. A lower
    // limit fails earlier with a different error, and a limit one above it
    // fails on the second dup, so the scan cannot step over the window.
    //
    // At startup bun walks the cwd's directory chain with one open fd per
    // level. From a deep temp dir that walk needs more fds than the dup
    // does, and no limit reaches the dup. Run from `/` so the walk is one
    // directory.
    let stderr: string | undefined;
    for (let limit = 6; limit <= 16; limit++) {
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `ulimit -n ${limit} && exec "$0" "$1"`, bunExe(), join(String(dir), "hello.sh")],
        cwd: "/",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (err.includes("Failed to run script hello.sh")) {
        expect(exitCode).toBe(1);
        stderr = err;
        break;
      }
      if (out === "hello\n") break;
    }

    expect(stderr, "no fd limit between 6 and 16 made the shell's dup fail").toBeDefined();
    // `dup` is implemented with `fcntl(F_DUPFD_CLOEXEC)`, so that is the
    // syscall the error names.
    expect(stderr).toBe("EMFILE: Too many open files: Failed to run script hello.sh (fcntl)\n");
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
