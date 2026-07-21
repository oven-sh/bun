import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `-c` / `--config` must bind its path argument in every spelling.
// https://github.com/oven-sh/bun/issues/6300, https://github.com/oven-sh/bun/issues/21431

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
    // Local 404 registry so nothing ever reaches the public network, even if
    // parsing regresses and routes the path to `bun add`.
    const hits: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        hits.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    const base = `http://localhost:${server.port}`;

    using dir = tempDir("config-flag-install", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      // Auto-loaded when `--config` is NOT effective (regression).
      "bunfig.toml": `[install]\nregistry = "${base}/default/"\ncache = false\n`,
      // Loaded when `--config cfg.toml` IS effective (the fix).
      "cfg.toml": `[install]\nregistry = "${base}/fromcfg/"\ncache = false\n`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), ["install", ...flag]);
    const out = stdout + stderr;

    // The path must never be routed to `bun add` as a package name.
    expect(out).not.toContain("bun add");
    expect(hits).not.toContain("/default/cfg.toml");
    // The named config must have been loaded, not the auto-loaded bunfig.toml.
    expect(hits).toContain("/fromcfg/no-deps");
    expect(hits).not.toContain("/default/no-deps");
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
