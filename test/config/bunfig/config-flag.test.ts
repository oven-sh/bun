import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `-c` / `--config` must bind its path argument in every spelling. Previously
// the flag was optional-value, so `--config cfg.toml` / `-c cfg.toml` left the
// path as a positional (turning `bun install --config cfg.toml` into
// `bun add cfg.toml`), and `-c=cfg.toml` dropped the value entirely.

async function run(cwd: string, argv: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const spellings = [
  ["--config=cfg.toml"],
  ["--config", "cfg.toml"],
  ["-c=cfg.toml"],
  ["-c", "cfg.toml"],
  ["-ccfg.toml"],
];

describe.concurrent("bun install --config path binding", () => {
  test.each(spellings)("install %p loads the named config, never treats it as a package", async (...flag) => {
    using dir = tempDir("config-flag-install", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { "is-odd": "*" } }),
      // A config that points the registry at a closed port. If honored,
      // resolution fails before any public-registry GET.
      "cfg.toml": `[install]\nregistry = "http://127.0.0.1:1/"\n`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), ["install", ...flag]);
    const out = stdout + stderr;

    // The path must never be routed to `bun add` as a package name.
    expect(out).not.toContain("bun add");
    expect(out).not.toContain("/cfg.toml");
    // The config must have been loaded: install should fail against the
    // dead registry, not succeed against the public one.
    expect(out.toLowerCase()).toMatch(/connectionrefused|econnrefused|failed to resolve/);
    expect(exitCode).not.toBe(0);
  });

  test("bare --config errors instead of silently defaulting", async () => {
    using dir = tempDir("config-flag-install-bare", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
    });
    const { stderr, exitCode } = await run(String(dir), ["install", "--config"]);
    expect(stderr).toContain("--config");
    expect(stderr.toLowerCase()).toContain("requires a value");
    expect(exitCode).not.toBe(0);
  });
});

describe.concurrent("bun <script> --config path binding", () => {
  test.each(spellings)("%p loads the named config and runs the script positional", async (...flag) => {
    using dir = tempDir("config-flag-run", {
      "app.ts": `console.log(JSON.stringify({ fromCfg: process.env.FROM_CFG ?? "no", argv: process.argv.slice(2) }));`,
      "cfg.toml": `[define]\n"process.env.FROM_CFG" = '"yes"'\n`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), [...flag, join(String(dir), "app.ts"), "pass-through"]);
    // The config path must not be treated as the entry point.
    expect(stderr).not.toContain("cfg.toml");
    expect(JSON.parse(stdout.trim())).toEqual({ fromCfg: "yes", argv: ["pass-through"] });
    expect(exitCode).toBe(0);
  });
});
