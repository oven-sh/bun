import { describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// A bunfig.toml that exists but cannot be read must fail the command. Before,
// the auto-loader treated every open error like a missing file, so `preload`,
// `[define]` and `[test]` settings were dropped without a message.
describe.concurrent("bunfig.toml that exists but cannot be read", () => {
  const files = {
    "pre.ts": `globalThis.PRE = 1;`,
    "app.ts": `console.log("preload ran:", globalThis.PRE === 1);`,
    "package.json": `{ "name": "t", "scripts": { "hi": "echo SCRIPT-RAN" } }`,
  };

  const commands: [name: string, argv: string[]][] = [
    ["bun <file>", ["app.ts"]],
    ["bun run <file>", ["run", "app.ts"]],
    ["bun run <script>", ["run", "hi"]],
    ["bun -e", ["-e", "console.log('preload ran:', globalThis.PRE === 1)"]],
    ["bun test", ["test"]],
  ];

  async function run(dir: string, argv: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...argv],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each(commands)("%s fails when bunfig.toml is a directory", async (_, argv) => {
    using dir = tempDir("bunfig-eisdir", { ...files, "bunfig.toml/.keep": "" });
    const { stdout, stderr, exitCode } = await run(String(dir), argv);
    expect(stderr).toContain("while reading config");
    expect(stderr).toContain("bunfig.toml");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  const canDenyRead = !isWindows && process.getuid?.() !== 0;
  test.skipIf(!canDenyRead).each(commands)("%s fails when bunfig.toml is not readable", async (_, argv) => {
    using dir = tempDir("bunfig-eacces", { ...files, "bunfig.toml": `preload = ["./pre.ts"]\n` });
    chmodSync(join(String(dir), "bunfig.toml"), 0o000);
    const { stdout, stderr, exitCode } = await run(String(dir), argv);
    expect(stderr).toContain("EACCES");
    expect(stderr).toContain("while reading config");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("a missing bunfig.toml is still fine", async () => {
    using dir = tempDir("bunfig-enoent", files);
    const { stdout, exitCode } = await run(String(dir), ["app.ts"]);
    expect(stdout).toBe("preload ran: false\n");
    expect(exitCode).toBe(0);
  });
});

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
