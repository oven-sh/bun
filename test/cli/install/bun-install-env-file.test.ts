import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/12011
// `bun install` always loaded the production `.env` files for bunfig `$VAR`
// substitution. It ignored --env-file, --no-env-file, bunfig `env = false` and
// NODE_ENV=development.

type Files = Record<string, string>;

const packageJson = JSON.stringify({
  name: "env-file-install",
  version: "1.0.0",
  dependencies: { "no-deps": "1.0.0" },
});

// The registry token comes from `$NPM_TOKEN`, so the Authorization header the
// registry receives shows which `.env*` file install loaded.
const bunfig = (port: number) => `[install]
cache = false
registry = { url = "http://localhost:${port}/", token = "$NPM_TOKEN" }
`;

function projectFiles(port: number): Files {
  return {
    "package.json": packageJson,
    "bunfig.toml": bunfig(port),
    ".env": "NPM_TOKEN=BASE\n",
    ".env.development": "NPM_TOKEN=DEV\n",
    ".env.production": "NPM_TOKEN=PROD\n",
    ".env.test": "NPM_TOKEN=TESTSUFFIX\n",
    ".env.custom": "NPM_TOKEN=CUSTOM\n",
  };
}

type RunOptions = {
  files: (port: number) => Files;
  argv: string[];
  /** Relative to the temp dir. */
  cwd?: string;
  env?: (root: string, port: number) => Record<string, string>;
};

/** Runs `bun <argv>` against a loopback registry that records each Authorization header. */
async function run(opts: RunOptions): Promise<{ auth: string[]; stderr: string }> {
  const received: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      received.push(req.headers.get("authorization") ?? "<none>");
      return new Response("{}", { status: 404 });
    },
  });

  using dir = tempDir("install-env-file", opts.files(server.port));
  const root = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...opts.argv],
    cwd: join(root, opts.cwd ?? "."),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      BUN_ENV: undefined,
      NPM_TOKEN: undefined,
      ...opts.env?.(root, server.port),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { auth: received, stderr };
}

const runInstall = (extraArgs: string[], extraEnv: Record<string, string> = {}) =>
  run({ files: projectFiles, argv: ["install", ...extraArgs], env: () => extraEnv });

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

  // Only `development` moves install off the production files.
  const modes: [label: string, env: Record<string, string>, token: string][] = [
    ["NODE_ENV=development", { NODE_ENV: "development" }, "DEV"],
    ["BUN_ENV=development", { BUN_ENV: "development", NODE_ENV: "production" }, "DEV"],
    ["NODE_ENV=production", { NODE_ENV: "production" }, "PROD"],
    ["NODE_ENV=test", { NODE_ENV: "test" }, "PROD"],
    ["no NODE_ENV", {}, "PROD"],
  ];
  test.concurrent.each(modes)("default files with %s", async (_label, env, token) => {
    const { auth } = await runInstall([], env);
    expect(auth[0]).toBe(`Bearer ${token}`);
  });

  // With no file loaded and no NPM_TOKEN in the process env, `$NPM_TOKEN` is
  // unresolved: sent as written, or not sent. A loaded file gives "Bearer PROD".
  const unresolved = ["Bearer $NPM_TOKEN", "<none>"];

  test.concurrent("--no-env-file suppresses auto-loading", async () => {
    const { auth, stderr } = await runInstall(["--no-env-file"]);
    expect(unresolved).toContain(auth[0]);
    expect(stderr).not.toContain(".env");
  });

  test.concurrent("bunfig `env = false` suppresses auto-loading", async () => {
    const { auth, stderr } = await run({
      files: port => ({ ...projectFiles(port), "bunfig.toml": `env = false\n${bunfig(port)}` }),
      argv: ["install"],
    });
    expect(unresolved).toContain(auth[0]);
    expect(stderr).not.toContain(".env");
  });

  test.concurrent("`bun --env-file=PATH install` (flag before the subcommand) works", async () => {
    const { auth } = await run({ files: projectFiles, argv: ["--env-file=.env.custom", "install"] });
    expect(auth[0]).toBe("Bearer CUSTOM");
  });

  test.concurrent("--env-file value is consumed, not treated as a package to add", async () => {
    using dir = tempDir("install-env-file-value", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "bunfig.toml": `[install]\nregistry = "http://localhost:1/"\n`,
      "ci.env": "A=1\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--env-file", "ci.env"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, NPM_TOKEN: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("unrecognised dependency format");
    expect(stdout).not.toMatch(/add v\d/);
    expect(exitCode).toBe(0);
  });
});

// Install changes into the project root, the workspace root, or the global
// directory before it resolves packages. Each layout puts a decoy of the same
// name there, so a path that is resolved after the change reads the decoy.
describe("a relative --env-file is resolved against the directory the command runs in", () => {
  const nested = (port: number): Files => ({
    "package.json": packageJson,
    "bunfig.toml": bunfig(port),
    ".env.ci": "NPM_TOKEN=ROOT\n",
    ".env.production": "NPM_TOKEN=ROOT_PROD\n",
    "sub/.env.ci": "NPM_TOKEN=SUB\n",
    "sub/.env.a": "NPM_TOKEN=A\n",
    "sub/.env.b": "NPM_TOKEN=B\n",
    "sub/.env.production": "NPM_TOKEN=SUB_PROD\n",
  });

  const workspace = (port: number): Files => ({
    "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
    "bunfig.toml": bunfig(port),
    ".env.ci": "NPM_TOKEN=ROOT\n",
    "packages/foo/package.json": JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0" },
    }),
    "packages/foo/.env.ci": "NPM_TOKEN=MEMBER\n",
  });

  const globalDir =
    (extra: Files) =>
    (port: number): Files => ({
      "work/.env.ci": "NPM_TOKEN=WORK\n",
      "global/bunfig.toml": bunfig(port),
      "global/.env.ci": "NPM_TOKEN=GLOBAL\n",
      ...extra,
    });
  const addGlobal = { cwd: "work", argv: ["add", "-g", "--env-file", ".env.ci", "no-deps"] };
  const globalEnv = (root: string, port: number) => ({
    BUN_INSTALL_GLOBAL_DIR: join(root, "global"),
    BUN_INSTALL_BIN: join(root, "bin"),
    BUN_CONFIG_REGISTRY: `http://localhost:${port}/`,
  });

  const rows: [label: string, opts: RunOptions, token: string][] = [
    ["from a subdirectory", { files: nested, cwd: "sub", argv: ["install", "--env-file", ".env.ci"] }, "SUB"],
    [
      "from a workspace member",
      { files: workspace, cwd: "packages/foo", argv: ["install", "--env-file", ".env.ci"] },
      "MEMBER",
    ],
    ["after --cwd", { files: nested, argv: ["install", "--cwd", "sub", "--env-file", ".env.ci"] }, "SUB"],
    ["with a ../ path", { files: nested, cwd: "sub", argv: ["install", "--env-file", "../.env.ci"] }, "ROOT"],
    [
      "for each file of a comma list",
      { files: nested, cwd: "sub", argv: ["install", "--env-file=.env.a,.env.b"] },
      "B",
    ],
    [
      "for each repeated flag",
      { files: nested, cwd: "sub", argv: ["install", "--env-file", ".env.a", "--env-file", ".env.b"] },
      "B",
    ],
    ["by `bun add`", { files: nested, cwd: "sub", argv: ["add", "--env-file", ".env.ci", "left-pad"] }, "SUB"],
    // Without a package.json there, install creates one and starts over.
    [
      "by `bun add -g` into a global directory without a package.json",
      { ...addGlobal, files: globalDir({}), env: globalEnv },
      "WORK",
    ],
    [
      "by `bun add -g` into a global directory with a package.json",
      { ...addGlobal, files: globalDir({ "global/package.json": "{}" }), env: globalEnv },
      "WORK",
    ],
  ];

  test.concurrent.each(rows)("%s", async (_label, opts, token) => {
    const { auth } = await run(opts);
    expect(auth[0]).toBe(`Bearer ${token}`);
  });

  test.concurrent("the default .env files still come from the project root", async () => {
    const { auth } = await run({ files: nested, cwd: "sub", argv: ["install"] });
    expect(auth[0]).toBe("Bearer ROOT_PROD");
  });
});

// https://github.com/oven-sh/bun/issues/31450
// Lifecycle scripts inherit whatever `bun install` loaded from `.env*`, so the
// flags also decide what package scripts get to see.
async function probeLifecycleEnv(extraArgs: string[]): Promise<{ seen: string; stderr: string; exitCode: number }> {
  using dir = tempDir("install-env-file-lifecycle", {
    "package.json": JSON.stringify({
      name: "env-file-lifecycle",
      version: "1.0.0",
      scripts: {
        // --no-env-file on the probe itself so it reports what install passed
        // down instead of loading the project's .env* files on its own.
        postinstall: `${bunExe()} --no-env-file -e 'await Bun.write("probe.txt", String(process.env.INSTALL_ENV_PROBE))'`,
      },
    }),
    ".env": "INSTALL_ENV_PROBE=from-dotenv\n",
    ".env.production": "INSTALL_ENV_PROBE=from-dotenv-production\n",
    ".env.custom": "INSTALL_ENV_PROBE=from-custom\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...extraArgs],
    cwd: String(dir),
    env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, INSTALL_ENV_PROBE: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const seen = await Bun.file(`${dir}/probe.txt`).text();
  return { seen, stderr, exitCode };
}

describe("bun install .env loading and lifecycle scripts (#31450)", () => {
  test.concurrent("by default the postinstall script sees the loaded .env* values", async () => {
    const { seen, stderr, exitCode } = await probeLifecycleEnv([]);
    expect(seen).toBe("from-dotenv-production");
    // The loader's banner quotes each file it loaded; the echoed postinstall
    // command line also mentions `process.env`, hence matching on the quote.
    expect(stderr).toContain('".env.production"');
    expect(exitCode).toBe(0);
  });

  test.concurrent("--no-env-file keeps .env* values out of the postinstall script", async () => {
    const { seen, stderr, exitCode } = await probeLifecycleEnv(["--no-env-file"]);
    expect(seen).toBe("undefined");
    expect(stderr).not.toContain('".env');
    expect(exitCode).toBe(0);
  });

  test.concurrent("--no-env-file together with --env-file still loads the explicit file", async () => {
    const { seen, stderr, exitCode } = await probeLifecycleEnv(["--no-env-file", "--env-file", ".env.custom"]);
    expect(seen).toBe("from-custom");
    expect(stderr).toContain('".env.custom"');
    expect(stderr).not.toContain('".env.production"');
    expect(exitCode).toBe(0);
  });
});
