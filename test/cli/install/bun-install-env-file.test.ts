import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/12011
// `bun install` hardcoded the dotenv suffix to Production and never looked at
// --env-file / --no-env-file / NODE_ENV, so bunfig `$VAR` substitution always
// used .env.production (or .env) regardless of what the user asked for.

function projectFiles(port: number) {
  return {
    "package.json": JSON.stringify({
      name: "env-file-install",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0" },
    }),
    "bunfig.toml": `[install]
cache = false
registry = { url = "http://localhost:${port}/", token = "$NPM_TOKEN" }
`,
    ".env": "NPM_TOKEN=BASE\n",
    ".env.development": "NPM_TOKEN=DEV\n",
    ".env.production": "NPM_TOKEN=PROD\n",
    ".env.test": "NPM_TOKEN=TESTSUFFIX\n",
    ".env.custom": "NPM_TOKEN=CUSTOM\n",
  };
}

async function runInstall(
  extraArgs: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ auth: string[]; stderr: string }> {
  const received: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      received.push(req.headers.get("authorization") ?? "<none>");
      return new Response("{}", { status: 404 });
    },
  });

  using dir = tempDir("install-env-file", projectFiles(server.port));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...extraArgs],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      BUN_ENV: undefined,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { auth: received, stderr };
}

describe("bun install .env loading (#12011)", () => {
  test.concurrent("--env-file loads the requested file for bunfig $VAR substitution", async () => {
    const { auth, stderr } = await runInstall(["--env-file", ".env.custom"]);
    expect(auth.length).toBeGreaterThan(0);
    expect(auth[0]).toBe("Bearer CUSTOM");
    expect(stderr).toContain(".env.custom");
    expect(stderr).not.toContain(".env.production");
  });

  test.concurrent("--env-file=PATH form works", async () => {
    const { auth } = await runInstall(["--env-file=.env.custom"]);
    expect(auth[0]).toBe("Bearer CUSTOM");
  });

  test.concurrent("NODE_ENV=development selects .env.development", async () => {
    const { auth, stderr } = await runInstall([], { NODE_ENV: "development" });
    expect(auth.length).toBeGreaterThan(0);
    expect(auth[0]).toBe("Bearer DEV");
    expect(stderr).toContain(".env.development");
  });

  test.concurrent("NODE_ENV=production selects .env.production", async () => {
    const { auth } = await runInstall([], { NODE_ENV: "production" });
    expect(auth[0]).toBe("Bearer PROD");
  });

  test.concurrent("NODE_ENV=test selects .env.test", async () => {
    const { auth } = await runInstall([], { NODE_ENV: "test" });
    expect(auth[0]).toBe("Bearer TESTSUFFIX");
  });

  test.concurrent("default (no NODE_ENV) matches `bun run` and selects .env.development", async () => {
    const { auth } = await runInstall([]);
    expect(auth[0]).toBe("Bearer DEV");
  });

  test.concurrent("--no-env-file suppresses auto-loading; only process env is used", async () => {
    const { auth, stderr } = await runInstall(["--no-env-file"], { NPM_TOKEN: "FROM_PROCESS" });
    expect(auth[0]).toBe("Bearer FROM_PROCESS");
    expect(stderr).not.toContain(".env");
  });

  test.concurrent("bunfig `env = false` suppresses auto-loading", async () => {
    const received: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        received.push(req.headers.get("authorization") ?? "<none>");
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("install-bunfig-env-false", {
      ...projectFiles(server.port),
      "bunfig.toml": `env = false
[install]
cache = false
registry = { url = "http://localhost:${server.port}/", token = "$NPM_TOKEN" }
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, NPM_TOKEN: "FROM_PROCESS" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(received[0]).toBe("Bearer FROM_PROCESS");
    expect(stderr).not.toContain(".env");
  });

  test.concurrent("--env-file value is consumed, not treated as a package to add", async () => {
    using dir = tempDir("install-env-missing", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--env-file", "does-not-exist.env"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("unrecognised dependency format");
    expect(stdout).not.toMatch(/add v\d/);
  });
});
