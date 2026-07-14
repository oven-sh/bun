import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(
  dir: string,
  cmd: string[],
  NODE_OPTIONS: string | undefined,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const env: Record<string, string | undefined> = { ...bunEnv, NODE_OPTIONS };
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("NODE_OPTIONS environment variable", () => {
  const fixtures = {
    "pre.mjs": `globalThis.__PRELOADED = true;\n`,
    "app.mjs": `console.log(globalThis.__PRELOADED === true ? "PRELOADED" : "NOT_PRELOADED");\n`,
    "A.mjs": `console.log("A");\n`,
    "B.mjs": `console.log("B");\n`,
  };

  describe.each([
    ["--import", "--import ./pre.mjs"],
    ["--import=", "--import=./pre.mjs"],
    ["--require", "--require ./pre.mjs"],
    ["--require=", "--require=./pre.mjs"],
    ["-r", "-r ./pre.mjs"],
  ])("preloads via %s", (_name, opts) => {
    test.concurrent("bun <file>", async () => {
      using dir = tempDir("node-options-preload", fixtures);
      const { stdout, exitCode } = await run(String(dir), ["app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
    });

    test.concurrent("bun run <file>", async () => {
      using dir = tempDir("node-options-preload-run", fixtures);
      const { stdout, exitCode } = await run(String(dir), ["run", "app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
    });
  });

  test.concurrent("NODE_OPTIONS preloads run before command-line preloads", async () => {
    using dir = tempDir("node-options-order", fixtures);
    const { stdout, exitCode } = await run(
      String(dir),
      ["--import", "./B.mjs", "-e", "console.log('main')"],
      "--import ./A.mjs",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "A\nB\nmain\n", exitCode: 0 });
  });

  test.concurrent("--require entries run before --import entries (Node parity)", async () => {
    using dir = tempDir("node-options-multi", fixtures);
    // --import is declared first but --require runs first (matches Node and `bun --import ... --require ...`).
    const { stdout, exitCode } = await run(
      String(dir),
      ["-e", "console.log('main')"],
      "--import ./B.mjs --require ./A.mjs",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "A\nB\nmain\n", exitCode: 0 });
  });

  test.concurrent("double-quoted values may contain spaces", async () => {
    using dir = tempDir("node-options-quotes", {
      "with space": { "sp.mjs": `console.log("SP");\n` },
    });
    const { stdout, exitCode } = await run(
      String(dir),
      ["-e", "console.log('main')"],
      `--import "./with space/sp.mjs"`,
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "SP\nmain\n", exitCode: 0 });
  });

  test.concurrent("unknown flag warns but does not exit", async () => {
    using dir = tempDir("node-options-unknown", fixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], "--definitely-not-a-real-flag");
    expect(stderr).toContain("--definitely-not-a-real-flag is not allowed in NODE_OPTIONS");
    expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("disallowed flag (--eval) warns but does not exit", async () => {
    using dir = tempDir("node-options-eval", fixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], "--eval 1");
    expect(stderr).toContain("--eval is not allowed in NODE_OPTIONS");
    expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("unknown flag after a preload still preloads and warns once", async () => {
    using dir = tempDir("node-options-mixed", fixtures);
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      ["app.mjs"],
      "--import ./pre.mjs --definitely-not-a-real-flag --also-junk",
    );
    expect(stderr).toContain("--definitely-not-a-real-flag is not allowed in NODE_OPTIONS");
    expect(stderr).not.toContain("--also-junk");
    expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("Bun-specific flags propagated via execArgv are accepted silently", async () => {
    using dir = tempDir("node-options-bunflag", fixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], "--bun --import ./pre.mjs");
    expect(stderr).not.toContain("is not allowed in NODE_OPTIONS");
    expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
  });

  test.each([
    ["--import", "--import"],
    ["--import=", "--import="],
    ["--require=", "--require="],
    ["-r", "-r"],
  ])("preload flag %s without value is rejected with exit code 9", async (_name, opts) => {
    using dir = tempDir("node-options-noval", fixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], opts);
    expect(stderr).toContain("requires an argument");
    expect(stdout).toBe("");
    expect(exitCode).toBe(9);
  });

  test.concurrent("unterminated double quote is rejected with exit code 9", async () => {
    using dir = tempDir("node-options-badquote", fixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], `--import "foo`);
    expect(stderr).toContain("invalid value for NODE_OPTIONS (unterminated string)");
    expect(stdout).toBe("");
    expect(exitCode).toBe(9);
  });

  describe.each([
    ["V8 flag (= form)", "--max-old-space-size=4096"],
    ["V8 flag (underscore form)", "--max_old_space_size=4096"],
    ["experimental flag", "--experimental-vm-modules"],
    ["--no-warnings", "--no-warnings"],
    ["--enable-source-maps", "--enable-source-maps"],
    ["bare -", "-"],
  ])("accepts allowed Node flag: %s", (_name, opts) => {
    test.concurrent("does not warn", async () => {
      using dir = tempDir("node-options-allowed", fixtures);
      const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], opts);
      expect(stderr).not.toContain("is not allowed in NODE_OPTIONS");
      expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
    });
  });

  describe.each([
    ["unset", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
  ])("no-op when NODE_OPTIONS is %s", (_name, opts) => {
    test.concurrent("runs normally", async () => {
      using dir = tempDir("node-options-empty", fixtures);
      const { stdout, exitCode } = await run(String(dir), ["app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
    });
  });

  test.concurrent("does not affect non-runtime commands (bun install)", async () => {
    using dir = tempDir("node-options-install", {
      "package.json": `{"name":"x","version":"1.0.0"}`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: { ...bunEnv, NODE_OPTIONS: "--definitely-not-a-real-flag" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("is not allowed in NODE_OPTIONS");
    expect(stdout).not.toContain("is not allowed in NODE_OPTIONS");
    expect(exitCode).toBe(0);
  });
});
