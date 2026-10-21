import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync } from "fs";
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

  // Each script has a complete command in front of the open quote. Nothing of the script runs.
  test.each([
    {
      name: "a shell file",
      files: { "script.sh": `touch MARKER\necho "start` },
      args: ["script.sh"],
      expectedStderr: "error: Failed to run script.sh due to error Unclosed double quote\n",
    },
    {
      name: "a package.json script run by the Bun shell",
      files: {
        "package.json": JSON.stringify({
          name: "unclosed-quote",
          scripts: { apostrophe: "touch MARKER && echo it's done" },
        }),
      },
      args: ["run", "--shell=bun", "apostrophe"],
      expectedStderr:
        "$ touch MARKER && echo it's done\n" +
        "error: Failed to run script apostrophe due to error Unclosed single quote\n",
    },
  ])("$name that ends inside an open quote is refused", async ({ files, args, expectedStderr }) => {
    using dir = tempDir("run-shell-unclosed-quote", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, ran: existsSync(join(String(dir), "MARKER")), exitCode }).toEqual({
      stdout: "",
      stderr: expectedStderr,
      ran: false,
      exitCode: 1,
    });
  });

  // On Windows these commands have no POSIX shell and no `--shell` switch: they run the script
  // as `bun exec --no-env-file <script>`, which exits 1. On every other platform `sh` refuses
  // the same script and exits 2.
  const refusalExitCode = isWindows ? 1 : 2;
  test.each([
    {
      name: "bun run --filter",
      files: {
        dep0: {
          "package.json": JSON.stringify({
            name: "dep0",
            scripts: { apostrophe: "touch MARKER && echo it's done" },
          }),
        },
      },
      args: ["run", "--filter", "*", "apostrophe"],
      marker: join("dep0", "MARKER"),
      expected: `dep0 apostrophe: Exited with code ${refusalExitCode}`,
    },
    {
      name: "bun install (root lifecycle script)",
      files: {
        "package.json": JSON.stringify({
          name: "unclosed-quote",
          version: "1.0.0",
          scripts: { postinstall: "touch MARKER && echo it's done" },
        }),
      },
      args: ["install"],
      marker: "MARKER",
      expected: `error: postinstall script from "unclosed-quote" exited with ${refusalExitCode}`,
    },
  ])("$name fails on a script that ends inside an open quote", async ({ files, args, marker, expected }) => {
    using dir = tempDir("run-shell-unclosed-quote", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdout + stderr;
    if (isWindows) expect(output).toContain("Unclosed single quote");
    expect(output).toContain(expected);
    expect({ ran: existsSync(join(String(dir), marker)), exitCode }).toEqual({ ran: false, exitCode: refusalExitCode });
  });

  // The Bun shell refuses a script that ends inside an open quote, so the quotes that `bun run`
  // puts around a pass-through argument must always pair.
  test("pass-through arguments that contain a quote or end in a backslash reach a Bun shell script", async () => {
    using dir = tempDir("run-shell-passthrough", {
      "package.json": JSON.stringify({ name: "passthrough", scripts: { args: "bun args.js" } }),
      "args.js": "console.log(JSON.stringify(process.argv.slice(2)));",
    });
    const passthrough = [".\\dist\\", "it's", 'a"b'];
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--shell=bun", "args", ...passthrough],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(passthrough) + "\n",
      stderr: String.raw`$ bun args.js ".\\dist\\" "it's" "a\"b"` + "\n",
      exitCode: 0,
    });
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
