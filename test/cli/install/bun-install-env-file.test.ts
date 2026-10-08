import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// The security scanner runs in a child `bun` that starts in the project root.
// That child loads the default `.env*` files by itself, so install passes its
// own decision on to it.
const scannerProbeKeys = [
  "SCAN_DOTENV",
  "SCAN_MODE",
  "SCAN_CUSTOM",
  "SCAN_SHELL",
  "BUN_FEATURE_FLAG_NO_ORPHANS",
  // Install sets this one for lifecycle scripts only.
  "npm_config_user_agent",
];

// Records which of the probe variables the scanner process has, and whether a
// postinstall script ran before it.
const scannerSource = `
import { existsSync, writeFileSync } from "node:fs";
export const scanner = {
  version: "1",
  async scan() {
    const seen = Object.fromEntries(${JSON.stringify(scannerProbeKeys)}.map(key => [key, process.env[key]]));
    if (existsSync("postinstall-ran.txt")) seen.afterPostinstall = true;
    writeFileSync("scanner-env.json", JSON.stringify(seen));
    return [];
  },
};
`;

const scannerBunfig = `[install]
cache = false

[install.security]
scanner = "./scanner.ts"
`;

// SCAN_SHELL is also in the real environment, and that value wins over a file.
const scannerProject: Files = {
  "package.json": JSON.stringify({
    name: "env-file-scanner",
    version: "1.0.0",
    dependencies: { dep: "file:./dep" },
  }),
  "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
  "other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }),
  "bunfig.toml": scannerBunfig,
  "scanner.ts": scannerSource,
  ".env": "SCAN_DOTENV=from-dotenv\nSCAN_SHELL=from-dotenv\n",
  ".env.development": "SCAN_MODE=development\n",
  ".env.production": "SCAN_MODE=production\n",
  "custom.env": "SCAN_CUSTOM=from-custom\nSCAN_SHELL=from-custom\n",
};

type ScanOptions = {
  argv?: string[];
  /** A `sh -c` script to run in place of `bun <argv>`. `$0` is bun. */
  sh?: string;
  /** Added to `scannerProject`. */
  files?: Files;
  /** Relative to the temp dir. */
  cwd?: string;
  env?: (root: string) => Record<string, string>;
};

/** Runs `bun <argv>` and returns what the scanner process recorded. */
async function scannerEnv(opts: ScanOptions) {
  using dir = tempDir("install-env-file-scanner", { ...scannerProject, ...opts.files });
  const root = String(dir);

  await using proc = Bun.spawn({
    cmd: opts.sh ? ["sh", "-c", opts.sh, bunExe()] : [bunExe(), ...(opts.argv ?? [])],
    cwd: join(root, opts.cwd ?? "."),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      BUN_ENV: undefined,
      SCAN_DOTENV: undefined,
      SCAN_MODE: undefined,
      SCAN_CUSTOM: undefined,
      SCAN_SHELL: "from-shell",
      BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
      npm_config_user_agent: undefined,
      ...opts.env?.(root),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // No probe file means the scanner did not run. stderr says why.
  const probe = Bun.file(join(root, "scanner-env.json"));
  const seen: unknown = (await probe.exists()) ? await probe.json() : stderr;
  return { seen, stdout, exitCode };
}

describe("bun install .env loading and the security scanner", () => {
  const shell = { SCAN_SHELL: "from-shell" };
  const custom = { SCAN_CUSTOM: "from-custom", ...shell };

  const rows: [label: string, opts: ScanOptions, seen: Record<string, string | boolean>][] = [
    // Not a decided default: the scanner loads the runtime's files, install loads the production ones.
    [
      "without a flag the scanner loads the .env files itself",
      { argv: ["install"] },
      { SCAN_DOTENV: "from-dotenv", SCAN_MODE: "development", ...shell },
    ],
    ["--no-env-file", { argv: ["install", "--no-env-file"] }, shell],
    ["--env-file", { argv: ["install", "--env-file=custom.env"] }, custom],
    [
      "`env = false` in the global bunfig",
      {
        argv: ["install"],
        files: { "xdg/.bunfig.toml": "env = false\n" },
        env: root => ({ XDG_CONFIG_HOME: join(root, "xdg") }),
      },
      shell,
    ],
    [
      "`env = false` in a --config bunfig",
      {
        argv: ["install", "--config=ci/bunfig.toml"],
        files: { "ci/bunfig.toml": `env = false\n${scannerBunfig}` },
      },
      shell,
    ],
    // The scanner starts in the workspace root, not where the path is relative to.
    [
      "a relative --env-file from a workspace member",
      {
        argv: ["install", "--env-file", "member.env"],
        cwd: "packages/foo",
        files: {
          "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
          "packages/foo/package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
          "packages/foo/member.env": "SCAN_CUSTOM=from-member\n",
        },
      },
      { SCAN_CUSTOM: "from-member", ...shell },
    ],
    // Install sets this variable in its own environment after it has read the
    // --env-file files. The scanner reads the project bunfig.toml, not the global one.
    [
      "--env-file keeps `[run] noOrphans` of the global bunfig",
      {
        argv: ["install", "--env-file=custom.env"],
        files: { "xdg/.bunfig.toml": "[run]\nnoOrphans = true\n" },
        env: root => ({ XDG_CONFIG_HOME: join(root, "xdg") }),
      },
      { ...custom, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    ],
    ["bun add --env-file", { argv: ["add", "--env-file=custom.env", "./other"] }, custom],
    ["bun update --env-file", { argv: ["update", "--env-file=custom.env"] }, custom],
    ["bun remove --env-file", { argv: ["remove", "--env-file=custom.env", "dep"] }, custom],
    [
      "bun pm scan --env-file",
      {
        argv: ["pm", "scan", "--env-file=custom.env"],
        files: {
          "bun.lock": JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": { name: "env-file-scanner", dependencies: { dep: "file:./dep" } } },
            packages: { dep: ["dep@file:dep", {}] },
          }),
        },
      },
      custom,
    ],
  ];

  // Each case starts two bun processes, install and then the scanner. They run
  // one at a time to stay inside the default timeout on a debug build.
  test.each(rows)("%s", async (_label, opts, expected) => {
    const { seen, exitCode } = await scannerEnv(opts);
    expect(seen).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // A pipe can be read once. Install reads it, so the scanner must not be sent to the path.
  test.skipIf(isWindows)("--env-file from a pipe", async () => {
    const { seen, exitCode } = await scannerEnv({
      sh: `printf 'SCAN_CUSTOM=from-pipe\\n' | "$0" install --env-file=/dev/stdin`,
    });
    expect(seen).toEqual({ SCAN_CUSTOM: "from-pipe", ...shell });
    expect(exitCode).toBe(0);
  });

  // Open: a bun child reads BUN_OPTIONS again. This scanner also gets the root
  // member.env, and a FIFO named there blocks it. The case fails until that is closed.
  test.failing("BUN_OPTIONS=--env-file from a workspace member is not read again by the scanner", async () => {
    const { seen } = await scannerEnv({
      argv: ["install"],
      cwd: "packages/foo",
      files: {
        "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
        "packages/foo/package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
        "packages/foo/member.env": "SCAN_CUSTOM=from-member\n",
        "member.env": "SCAN_DOTENV=from-root-member\n",
      },
      env: () => ({ BUN_OPTIONS: "--env-file=member.env" }),
    });
    expect(seen).toEqual({ SCAN_CUSTOM: "from-member", ...shell });
  });

  // The scanner package is not installed yet, so the first child fails to
  // import it. Install then adds the package, runs its postinstall, and starts
  // a second child. That child must not get the variables of the script run.
  test("the scanner that install adds from npm gets the --env-file values", async () => {
    const postinstall = `${bunExe()} --no-env-file -e 'await Bun.write(process.env.INIT_CWD + "/postinstall-ran.txt", "1")'`;
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({
          name: "probe-scanner",
          version: "1.0.0",
          type: "module",
          scripts: { postinstall },
        }),
        "package/index.js": scannerSource,
      },
      { compress: "gzip" },
    ).bytes();
    await using registry = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith(".tgz")) return new Response(tarball);
        const dist = { tarball: `http://localhost:${registry.port}/probe-scanner-1.0.0.tgz` };
        return Response.json({
          name: "probe-scanner",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "probe-scanner", version: "1.0.0", scripts: { postinstall }, dist } },
        });
      },
    });

    const { seen, stdout, exitCode } = await scannerEnv({
      argv: ["install", "--env-file=custom.env"],
      files: {
        "package.json": JSON.stringify({
          name: "env-file-scanner",
          version: "1.0.0",
          dependencies: { "probe-scanner": "1.0.0" },
          trustedDependencies: ["probe-scanner"],
        }),
        "bunfig.toml": `[install]
cache = false
registry = "http://localhost:${registry.port}/"

[install.security]
scanner = "probe-scanner"
`,
      },
    });
    expect(seen).toEqual({ ...custom, afterPostinstall: true });
    expect(stdout).toContain("Security scanner installed successfully");
    expect(exitCode).toBe(0);
  });
});
