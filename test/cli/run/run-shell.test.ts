import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
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

// A FROM-scratch or distroless image has no /bin/sh. `--shell=bun` must not need one. hide-paths.c
// makes every path that the shell lookup probes look absent, and PATH points at an empty directory.
describe.skipIf(!isLinux)("bun run on a system with no shell", () => {
  const shellPaths = [
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
    "/bin/sh",
    "/usr/bin/sh",
    "/usr/bin/zsh",
    "/usr/local/bin/zsh",
    "/system/bin/sh",
  ];

  // The helper binary, or null when this host cannot build it (no cc, no kernel headers).
  const helper = (() => {
    if (!isLinux) return null;
    const bin = join(tmpdirSync(), "hide-paths");
    const compile = spawnSync("cc", ["-O0", "-o", bin, join(import.meta.dir, "hide-paths.c")], { stdio: "pipe" });
    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error("failed to compile hide-paths.c:\n" + stderr);
    }
    return bin;
  })();

  // Runs `bun run ...args` with no shell visible. Returns null when the test must skip.
  async function runWithoutShells(files: Record<string, string>, args: string[]) {
    if (helper == null) {
      // bun:test has no runtime skip. Say so, to tell this apart from a pass.
      console.warn("SKIP bun run with no shell: cc or the kernel headers are not available");
      return null;
    }
    using dir = tempDir("run-no-shell", {
      "package.json": JSON.stringify({
        name: "no-shell-fixture",
        version: "1.0.0",
        scripts: { prestart: "echo pre", start: "echo started", poststart: "echo post" },
      }),
      "empty-path/.keep": "",
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [helper, ...shellPaths, "--", bunExe(), "run", ...args],
      env: { ...bunEnv, PATH: join(String(dir), "empty-path") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) {
      console.warn("SKIP bun run with no shell: seccomp user notification is not permitted here");
      return null;
    }
    return { stdout, stderr, exitCode };
  }

  test.concurrent("--shell=bun runs the pre, main and post scripts", async () => {
    const result = await runWithoutShells({}, ["--shell=bun", "start"]);
    if (result == null) return;
    expect(result.stdout).toBe("pre\nstarted\npost\n");
    expect(result.exitCode).toBe(0);
  });

  test.concurrent('bunfig [run] shell = "bun" runs the scripts', async () => {
    const result = await runWithoutShells({ "bunfig.toml": '[run]\nshell = "bun"\n' }, ["start"]);
    if (result == null) return;
    expect(result.stdout).toBe("pre\nstarted\npost\n");
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("the system shell reports what is missing and how to continue", async () => {
    const result = await runWithoutShells({}, ["start"]);
    if (result == null) return;
    expect(result.stderr).toContain("error: Bun could not find a system shell (bash, sh, or zsh) to run this script");
    expect(result.stderr).toContain("--shell=bun");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });
});
