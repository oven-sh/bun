import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
