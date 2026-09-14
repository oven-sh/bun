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

// A signal sent to the runner's pid alone (kill, docker stop, systemd), not to
// the process group. proc.kill() is TerminateProcess on Windows and reaches no
// handler, so this is POSIX only. Sequential: each case starts two debug
// builds of bun, and several at once overrun the per-test budget under ASAN.
describe.skipIf(isWindows)("signal to the bun shell runner", () => {
  // Prints its pid, then waits. With a signal name as its argument it handles
  // that signal and exits 7. SIGUSR1 ends it with 0.
  const fixture = `
    const sig = process.argv[2];
    if (sig) process.on(sig, () => { console.log("got " + sig); process.exit(7); });
    process.on("SIGUSR1", () => process.exit(0));
    console.log("ready " + process.pid);
    setTimeout(() => {}, 30_000);
  `;

  function project(prefix: string, script: string) {
    return tempDir(prefix, {
      "child.js": fixture,
      "package.json": JSON.stringify({ name: "p", scripts: { wait: script } }),
    });
  }

  async function runAndSignal(cmd: string[], cwd: string, signal: "SIGTERM" | "SIGHUP", endChild = false) {
    await using proc = Bun.spawn({
      cmd,
      cwd,
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const ready = Promise.withResolvers<number>();
    let stdout = "";
    const stdoutDone = (async () => {
      for await (const chunk of proc.stdout) {
        stdout += new TextDecoder().decode(chunk);
        const m = stdout.match(/ready (\d+)/);
        if (m) ready.resolve(Number(m[1]));
      }
      ready.reject(new Error(`stdout ended before the child was ready:\n${stdout}`));
    })();
    const childPid = await ready.promise;
    proc.kill(signal);
    if (endChild) process.kill(childPid, "SIGUSR1");
    const exitCode = await proc.exited;
    // The runner waited for the child, so the child is gone once the runner is.
    // An orphan still holds the stdio pipes open, so check (and end it) before
    // reading them to the end.
    let childAlive = true;
    try {
      process.kill(childPid, 0);
      process.kill(childPid, "SIGKILL");
    } catch {
      childAlive = false;
    }
    const [, stderr] = await Promise.all([stdoutDone, proc.stderr.text()]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode, childAlive };
  }

  test("bun run --shell=bun forwards SIGTERM to the command and dies from it", async () => {
    using dir = project("run-shell-sigterm", `${bunExe()} child.js`);
    const r = await runAndSignal([bunExe(), "run", "--shell=bun", "wait"], String(dir), "SIGTERM");
    expect(r.childAlive).toBe(false);
    expect(r.stderr).toContain('script "wait" was terminated by signal SIGTERM');
    expect(r.signalCode).toBe("SIGTERM");
  });

  test("bun exec forwards SIGHUP to the command and exits 129", async () => {
    using dir = project("run-shell-exec-sighup", "");
    const r = await runAndSignal([bunExe(), "exec", `${bunExe()} child.js`], String(dir), "SIGHUP");
    expect(r.childAlive).toBe(false);
    expect(r.exitCode).toBe(129);
  });

  test("a command that handles the forwarded SIGTERM keeps its own exit code", async () => {
    using dir = project("run-shell-sigterm-handled", `${bunExe()} child.js SIGTERM`);
    const r = await runAndSignal([bunExe(), "run", "--shell=bun", "wait"], String(dir), "SIGTERM");
    expect(r.childAlive).toBe(false);
    expect(r.stdout).toContain("got SIGTERM");
    expect(r.stderr).toContain('script "wait" exited with code 7');
    expect(r.exitCode).toBe(7);
  });

  test("the script stops at the command that received the signal", async () => {
    using dir = project("run-shell-sigterm-sequence", `${bunExe()} child.js; echo after`);
    const r = await runAndSignal([bunExe(), "run", "--shell=bun", "wait"], String(dir), "SIGTERM");
    expect(r.childAlive).toBe(false);
    expect(r.stdout).not.toContain("after");
    expect(r.signalCode).toBe("SIGTERM");
  });

  test("a script with no subprocess to forward to dies from the signal at once", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", "echo ready; yes > /dev/null"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    let stdout = "";
    while (!stdout.includes("ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += new TextDecoder().decode(value);
    }
    expect(stdout).toContain("ready");
    proc.kill("SIGTERM");
    await proc.exited;
    expect(proc.signalCode).toBe("SIGTERM");
  });

  test("a SIGTERM the runner inherited as ignored stays ignored", async () => {
    using dir = project("run-shell-sigterm-ignored", `${bunExe()} child.js`);
    const r = await runAndSignal(
      ["sh", "-c", 'trap "" TERM; exec "$0" run --shell=bun wait', bunExe()],
      String(dir),
      "SIGTERM",
      true,
    );
    expect(r.childAlive).toBe(false);
    expect(r.stderr).toBe(`$ ${bunExe()} child.js\n`);
    expect(r.exitCode).toBe(0);
  });
});
