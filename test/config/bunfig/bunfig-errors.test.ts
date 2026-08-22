import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "node:path";

describe.concurrent("bunfig.toml type-mismatch error messages", () => {
  const cases: [config: string, expected: string][] = [
    [`smol = "yes"`, "expected boolean but received string"],
    [`logLevel = 3`, "expected string but received number"],
    [`telemetry = "no"`, "expected boolean but received string"],
    [`define = 3`, "expected object but received number"],
    [`[serve]\nport = "abc"`, "expected number but received string"],
  ];

  test.each(cases)("%s -> %s", async (config, expected) => {
    using dir = tempDir("bunfig-type-mismatch", {
      "bunfig.toml": config + "\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "1"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const errorLine = stderr.split("\n").find(l => l.startsWith("error:")) ?? stderr;
    expect(errorLine).toBe(`error: ${expected}`);
    expect(stderr).not.toMatch(/\be_(string|boolean|number|object|array|null)\b/);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
});

// No Windows variant: FIFOs and device files are POSIX.
describe.skipIf(isWindows).concurrent("config file that is not a regular file", () => {
  async function run(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, "-e", "console.log('ran')"],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The open of the FIFO used to block the process before it ran anything.
  test("a bunfig.toml that bun found on its own is skipped like an unreadable one", async () => {
    using dir = tempDir("bunfig-fifo", {});
    mkfifo(join(String(dir), "bunfig.toml"));

    expect(await run(String(dir))).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0 });
  });

  // The user named this one, so it is read whatever it is.
  test("--config=/dev/null is an empty config", async () => {
    using dir = tempDir("bunfig-dev-null", { "bunfig.toml": `smol = "not read"\n` });

    expect(await run(String(dir), "--config=/dev/null")).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0 });
  });
});
