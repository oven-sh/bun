import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";

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
  // The repro from issue #40316: a package.json `imports` map with a
  // `development` condition. react-router dev 8.3+ relaunches itself with
  // NODE_OPTIONS=--conditions=development and breaks when it is ignored.
  const conditionsFixtures = {
    "package.json": `{"name":"cond","type":"module","imports":{"#c":{"development":"./true.mjs","default":"./false.mjs"}}}`,
    "true.mjs": `export default true;\n`,
    "false.mjs": `export default false;\n`,
    "probe.mjs": `import v from "#c"; console.log(v);\n`,
  };

  describe.each([
    ["--conditions=development"],
    ["--conditions development"],
    ["-C development"],
    [`--conditions "development"`],
  ])("applies --conditions via %s", opts => {
    test.concurrent("bun <file>", async () => {
      using dir = tempDir("node-options-cond", conditionsFixtures);
      const { stdout, stderr, exitCode } = await run(String(dir), ["probe.mjs"], opts);
      expect(stderr).not.toContain("not allowed");
      expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    });

    test.concurrent("bun run <file>", async () => {
      using dir = tempDir("node-options-cond-run", conditionsFixtures);
      const { stdout, exitCode } = await run(String(dir), ["run", "probe.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    });
  });

  const preloadFixtures = {
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
      using dir = tempDir("node-options-preload", preloadFixtures);
      const { stdout, exitCode } = await run(String(dir), ["app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
    });

    test.concurrent("bun run <file>", async () => {
      using dir = tempDir("node-options-preload-run", preloadFixtures);
      const { stdout, exitCode } = await run(String(dir), ["run", "app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
    });
  });

  test.concurrent("NODE_OPTIONS preloads run before command-line preloads", async () => {
    using dir = tempDir("node-options-order", preloadFixtures);
    const { stdout, exitCode } = await run(
      String(dir),
      ["--import", "./B.mjs", "-e", "console.log('main')"],
      "--import ./A.mjs",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "A\nB\nmain\n", exitCode: 0 });
  });

  test.concurrent("--require entries run before --import entries (Node parity)", async () => {
    using dir = tempDir("node-options-multi", preloadFixtures);
    // --import is declared first but --require runs first, as in Node and
    // in `bun --import ... --require ...`.
    const { stdout, exitCode } = await run(
      String(dir),
      ["-e", "console.log('main')"],
      "--import ./B.mjs --require ./A.mjs",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "A\nB\nmain\n", exitCode: 0 });
  });

  test.concurrent("applies --no-warnings", async () => {
    using dir = tempDir("node-options-no-warnings", {});
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      ["-e", `process.emitWarning("from-test"); console.log("ok")`],
      "--no-warnings",
    );
    expect(stderr).not.toContain("from-test");
    expect({ stdout, exitCode }).toEqual({ stdout: "ok\n", exitCode: 0 });
  });

  test.concurrent("applies --title", async () => {
    using dir = tempDir("node-options-title", {});
    const { stdout, exitCode } = await run(String(dir), ["-e", "console.log(process.title)"], "--title=from-env");
    expect({ stdout, exitCode }).toEqual({ stdout: "from-env\n", exitCode: 0 });
  });

  test.concurrent("applies --dns-result-order (issue #28817)", async () => {
    using dir = tempDir("node-options-dns", {});
    const { stdout, exitCode } = await run(
      String(dir),
      ["-e", `import dns from "node:dns"; console.log(dns.getDefaultResultOrder())`],
      "--dns-result-order=ipv4first",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "ipv4first\n", exitCode: 0 });
  });

  // Node strips one backslash from a space-separated value that starts with
  // `\-`, and only there: an inline `=` value keeps it, `\\-x` keeps both, and
  // inside double quotes `\-` is the tokenizer's escape, so the value is `-x`.
  describe.each([
    ["--title \\-x", "-x"],
    ['--title "\\\\-x"', "-x"],
    ["--title=\\-x", "\\-x"],
    ["--title \\\\-x", "\\\\-x"],
  ])("a value may start with a dash only when escaped: %s", (opts, title) => {
    test.concurrent("sets the title", async () => {
      using dir = tempDir("node-options-escaped-dash", {});
      const { stdout, exitCode } = await run(String(dir), ["-e", "console.log(process.title)"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: `${title}\n`, exitCode: 0 });
    });
  });

  test.concurrent("applies --use-openssl-ca (conflicts with a command-line CA flag, as on the CLI)", async () => {
    using dir = tempDir("node-options-ca", {});
    const { stdout, stderr, exitCode } = await run(String(dir), ["--use-bundled-ca", "-e", "1"], "--use-openssl-ca");
    expect(stderr).toContain("choose exactly one of --use-system-ca, --use-openssl-ca, or --use-bundled-ca");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test.concurrent("command-line flags win over NODE_OPTIONS", async () => {
    using dir = tempDir("node-options-precedence", {});
    const { stdout, exitCode } = await run(
      String(dir),
      ["--title=from-cli", "-e", "console.log(process.title)"],
      "--title=from-env",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "from-cli\n", exitCode: 0 });
  });

  test.concurrent("NODE_OPTIONS flags are not reported in process.execArgv", async () => {
    using dir = tempDir("node-options-execargv", {
      "argv.mjs": `console.log(JSON.stringify(process.execArgv));\n`,
    });
    const { stdout, exitCode } = await run(String(dir), ["--conditions=cli", "argv.mjs"], "--conditions=development");
    expect({ stdout, exitCode }).toEqual({ stdout: '["--conditions=cli"]\n', exitCode: 0 });
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

  // `--expose-internals` and `--test` are real Node flags that Node refuses
  // in NODE_OPTIONS (exit 9). Bun warns and continues, like for unknown flags.
  test.each(["--definitely-not-a-real-flag", "--expose-internals", "--test"])(
    "flag outside the allowlist (%s) warns but does not exit",
    async flag => {
      using dir = tempDir("node-options-unknown", preloadFixtures);
      const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], flag);
      expect(stderr).toContain(`${flag} is not allowed in NODE_OPTIONS`);
      expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
    },
  );

  test.concurrent("disallowed flag (--eval) warns and does not evaluate", async () => {
    using dir = tempDir("node-options-eval", preloadFixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], `--eval "console.log('HIJACK')"`);
    expect(stderr).toContain("--eval is not allowed in NODE_OPTIONS");
    expect(stdout).not.toContain("HIJACK");
    expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("positional tokens cannot change the entrypoint", async () => {
    using dir = tempDir("node-options-positional", {
      ...preloadFixtures,
      "evil.mjs": `console.log("EVIL");\n`,
    });
    const { stdout, exitCode } = await run(String(dir), ["app.mjs"], "./evil.mjs");
    expect(stdout).not.toContain("EVIL");
    expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("unknown flag after a preload still preloads and warns once", async () => {
    using dir = tempDir("node-options-mixed", preloadFixtures);
    const { stdout, stderr, exitCode } = await run(
      String(dir),
      ["app.mjs"],
      "--import ./pre.mjs --definitely-not-a-real-flag --also-junk",
    );
    expect(stderr).toContain("--definitely-not-a-real-flag is not allowed in NODE_OPTIONS");
    expect(stderr).not.toContain("--also-junk");
    expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
  });

  test.concurrent("Bun-specific flags forwarded via execArgv are accepted silently", async () => {
    using dir = tempDir("node-options-bunflag", preloadFixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], "--bun --import ./pre.mjs");
    expect(stderr).not.toContain("is not allowed in NODE_OPTIONS");
    expect({ stdout, exitCode }).toEqual({ stdout: "PRELOADED\n", exitCode: 0 });
  });

  // Node names the flag as typed (underscores kept, trailing `=` kept). A
  // space-separated value that starts with a dash is the next flag, not a
  // value: `--require --import` must not try to load a module named
  // "--import", and a quoted `"\-x"` unescapes to `-x` before that check.
  test.each([
    ["--import", "--import"],
    ["--import=", "--import="],
    ["--require=", "--require="],
    ["-r", "-r"],
    ["--conditions", "--conditions"],
    ["--max_http_header_size", "--max_http_header_size"],
    ["--max_http_header_size=", "--max_http_header_size="],
    ["--require --import ./pre.mjs", "--require"],
    ["--conditions -C development", "--conditions"],
    ["--title --", "--title"],
    ['--title "\\-x"', "--title"],
  ])("required value missing for %s is rejected with exit code 9", async (opts, flag) => {
    using dir = tempDir("node-options-noval", preloadFixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], opts);
    expect(stderr).toContain(`${flag} requires an argument`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(9);
  });

  test.concurrent("unterminated double quote is rejected with exit code 9", async () => {
    using dir = tempDir("node-options-badquote", preloadFixtures);
    const { stdout, stderr, exitCode } = await run(String(dir), ["app.mjs"], `--import "foo`);
    expect(stderr).toContain("invalid value for NODE_OPTIONS (unterminated string)");
    expect(stdout).toBe("");
    expect(exitCode).toBe(9);
  });

  describe.each([
    ["V8 flag (= form)", "--max-old-space-size=4096"],
    ["V8 flag (underscore form)", "--max_old_space_size=4096"],
    ["V8 flag (space form)", "--max-old-space-size 4096"],
    ["experimental flag", "--experimental-vm-modules"],
    ["--enable-source-maps", "--enable-source-maps"],
    ["bare -", "-"],
  ])("ignores allowed Node flag silently: %s", (_name, opts) => {
    test.concurrent("does not warn", async () => {
      using dir = tempDir("node-options-allowed", preloadFixtures);
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
      using dir = tempDir("node-options-empty", preloadFixtures);
      const { stdout, exitCode } = await run(String(dir), ["app.mjs"], opts);
      expect({ stdout, exitCode }).toEqual({ stdout: "NOT_PRELOADED\n", exitCode: 0 });
    });
  });

  test.concurrent("BUN_OPTIONS wins over NODE_OPTIONS, execArgv hides only NODE_OPTIONS", async () => {
    using dir = tempDir("node-options-both", {
      "argv.mjs": `console.log(process.title, JSON.stringify(process.execArgv));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "argv.mjs"],
      env: { ...bunEnv, NODE_OPTIONS: "--title=from-node", BUN_OPTIONS: "--title=from-bun" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // BUN_OPTIONS tokens stay visible in execArgv (pre-existing Bun
    // behavior); NODE_OPTIONS tokens are hidden (Node parity).
    expect({ stdout, exitCode }).toEqual({ stdout: 'from-bun ["--title=from-bun"]\n', exitCode: 0 });
  });

  test.concurrent("every applied flag is in process.allowedNodeEnvironmentFlags", () => {
    const applied = [
      "--conditions",
      "-C",
      "--require",
      "-r",
      "--import",
      "--disable-warning",
      "--dns-result-order",
      "--max-http-header-size",
      "--redirect-warnings",
      "--title",
      "--unhandled-rejections",
      "--expose-gc",
      "--no-addons",
      "--no-deprecation",
      "--no-warnings",
      "--pending-deprecation",
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      "--throw-deprecation",
      "--trace-deprecation",
      "--trace-warnings",
      "--use-bundled-ca",
      "--use-openssl-ca",
      "--use-system-ca",
      "--zero-fill-buffers",
      "--inspect",
      "--inspect-brk",
      "--inspect-wait",
    ];
    expect(applied.filter(flag => !process.allowedNodeEnvironmentFlags.has(flag))).toEqual([]);
  });

  test.concurrent("does not break bun install", async () => {
    using dir = tempDir("node-options-install", {
      "package.json": `{"name":"x","version":"1.0.0"}`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: { ...bunEnv, NODE_OPTIONS: "--conditions=development --max-old-space-size=4096" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("not allowed");
    expect(exitCode).toBe(0);
  });

  // The injected tokens shift argv. Subcommands that index raw argv must
  // skip the injected window, or they read their own keyword as an argument.
  test.concurrent("bun init initializes the cwd, not a directory named 'init'", async () => {
    using dir = tempDir("node-options-init", {});
    const { exitCode } = await run(String(dir), ["init", "-y"], "--title=from-env");
    expect(await Bun.file(`${String(dir)}/package.json`).exists()).toBe(true);
    expect(await Bun.file(`${String(dir)}/init/package.json`).exists()).toBe(false);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun info queries the requested package, not 'info'", async () => {
    const requested: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        requested.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("node-options-info", {
      "package.json": `{"name":"x","version":"1.0.0"}`,
    });
    await Bun.write(`${String(dir)}/bunfig.toml`, `[install]\nregistry = "http://localhost:${server.port}/"\n`);
    await run(String(dir), ["info", "react"], "--title=from-env");
    expect(requested[0]).toBe("/react");
  });

  test.concurrent("bun upgrade does not read its own keyword as a package name", async () => {
    using dir = tempDir("node-options-upgrade", {});
    // Exits before any network access. Without the offset fix the message
    // lists the shifted window: "bun update upgrade somepkg".
    const { stderr, exitCode } = await run(String(dir), ["upgrade", "somepkg"], "--title=from-env");
    expect(stderr).toContain("does not take package names");
    expect(stderr).toContain("`bun update somepkg`");
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun pm trust still requires package names", async () => {
    using dir = tempDir("node-options-trust", {
      "package.json": `{"name":"x","version":"1.0.0"}`,
    });
    // Without the offset fix the empty-args guard is bypassed and the
    // command proceeds to load the lockfile.
    const { stderr, exitCode } = await run(String(dir), ["pm", "trust"], "--title=from-env");
    expect(stderr).toContain("expected package names(s) or --all");
    expect(exitCode).toBe(1);
  });

  // bunx's internal install child re-enters which() with argv0 = bunx and
  // BUN_INTERNAL_BUNX_INSTALL=true; the "add" keyword must still be found
  // after the injected window or the child loops as bunx (#39377 class).
  test.skipIf(isWindows)("bunx internal add dispatch still finds the keyword", async () => {
    using dir = tempDir("node-options-bunx", {});
    symlinkSync(bunExe(), `${String(dir)}/bunx`);
    await using proc = Bun.spawn({
      cmd: [`${String(dir)}/bunx`, "add", "--help"],
      env: { ...bunEnv, NODE_OPTIONS: "--title=from-env", BUN_INTERNAL_BUNX_INSTALL: "true" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("bun add");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun whoami still resolves to whoami", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/-/whoami") return Response.json({ username: "testuser" });
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("node-options-whoami", {
      "package.json": `{"name":"x","version":"1.0.0"}`,
    });
    await Bun.write(
      `${String(dir)}/.npmrc`,
      `//localhost:${server.port}/:_authToken=dummy\nregistry=http://localhost:${server.port}/\n`,
    );
    const { stdout, exitCode } = await run(String(dir), ["whoami"], "--title=from-env");
    expect({ stdout, exitCode }).toEqual({ stdout: "testuser\n", exitCode: 0 });
  });
});
