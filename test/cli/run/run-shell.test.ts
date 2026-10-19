import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { dirname, join } from "path";

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

// A root directory with no shell in it: a chroot in a private user and mount namespace.
// Skipped where those are disabled, like in most containers.
const canChangeRoot =
  isLinux &&
  Bun.which("unshare") !== null &&
  Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

// A FROM-scratch or distroless image has no /bin/sh. `--shell=bun` must not need one.
describe.skipIf(!canChangeRoot)("bun run on a system with no shell", () => {
  const changeRoot = `set -e
for dir in /lib /lib64 /usr/lib /proc "$BUN_DIR"; do
  [ -d "$dir" ] || continue
  mkdir -p "$NEW_ROOT$dir"
  mount -o rbind "$dir" "$NEW_ROOT$dir"
done
PATH="$PATH:/usr/sbin:/sbin"
exec chroot "$NEW_ROOT" "$@"`;

  async function runWithoutShells(files: Record<string, string>, args: string[]) {
    using dir = tempDir("run-no-shell", {
      "app/package.json": JSON.stringify({
        name: "no-shell-fixture",
        version: "1.0.0",
        scripts: { prestart: "echo pre", start: "echo started", poststart: "echo post" },
      }),
      "home/.keep": "",
      "tmp/.keep": "",
      ...files,
    });
    const bun = realpathSync(bunExe());
    await using proc = Bun.spawn({
      cmd: ["unshare", "-Urm", "/bin/sh", "-c", changeRoot, "sh", bun, "--cwd=/app", "run", ...args],
      env: { ...bunEnv, NEW_ROOT: String(dir), BUN_DIR: dirname(bun), HOME: "/home", TMPDIR: "/tmp" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("--shell=bun runs the pre, main and post scripts", async () => {
    const { stdout, exitCode } = await runWithoutShells({}, ["--shell=bun", "start"]);
    expect(stdout).toBe("pre\nstarted\npost\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent('bunfig [run] shell = "bun" runs the scripts', async () => {
    const { stdout, exitCode } = await runWithoutShells({ "app/bunfig.toml": '[run]\nshell = "bun"\n' }, ["start"]);
    expect(stdout).toBe("pre\nstarted\npost\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("the system shell reports what is missing and how to continue", async () => {
    const { stdout, stderr, exitCode } = await runWithoutShells({}, ["start"]);
    expect(stderr).toBe(
      "error: Bun could not find a system shell (bash, sh, or zsh) to run this script\n" +
        'note: To use Bun\'s built-in shell, pass --shell=bun to "bun run" or set shell = "bun" under [run] in bunfig.toml\n',
    );
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
