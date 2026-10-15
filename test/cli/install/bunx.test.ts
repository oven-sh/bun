import { spawn } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { copyFile, mkdir, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  type DirectoryTree,
  githubTarball,
  isDebug,
  isLinux,
  isWindows,
  readdirSorted,
  tempDir,
  tmpdirSync,
  unprivilegedSpawnOptions,
} from "harness";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "path";
import { dummyAfterAll, dummyBeforeAll, dummyBeforeEach, dummyRegistry, getPort, setHandler } from "./dummy.registry";

setDefaultTimeout(1000 * 60 * 5);

let x_dir: string;
let env = { ...bunEnv } as Record<string, string>;

// Each test that hits the network gets its own isolated tmpdir + install cache
// so the network-heavy tests can run concurrently without sharing bunx cache state.
function setup() {
  const install_cache_dir = tmpdirSync();
  const current_tmpdir = tmpdirSync();
  const x_dir = tmpdirSync();
  return {
    x_dir,
    env: {
      ...bunEnv,
      TEMP: current_tmpdir,
      BUN_TMPDIR: current_tmpdir,
      TMPDIR: current_tmpdir,
      BUN_INSTALL_CACHE_DIR: install_cache_dir,
    } as Record<string, string>,
  };
}

// Drop every PATH entry that already provides `name`, so `bunx <name>` cannot
// short-circuit to a binary that happens to be installed on this machine.
// Bun.which does the resolving, so Windows' .exe/.cmd lookup matches bunx's.
function pathWithout(name: string, PATH: string | undefined): string {
  return (PATH ?? "")
    .split(delimiter)
    .filter(dir => dir && !Bun.which(name, { PATH: dir }))
    .join(delimiter);
}

// Cases that need bunx to install something get a per-test in-process registry
// serving throwaway packages: what they assert is bunx's own behavior (name ->
// bin resolution, the bunx cache, argument passthrough), and installing real
// packages made the file's cost scale with their dependency trees instead
// (@angular/cli alone was ~21k files per run to extract and, once the CI runner
// removes TMPDIR, delete again). dummy.registry's per-test contexts only serve
// the .tgz files checked in next to it, answer every package name with the same
// version list, and have no GitHub shape; these generate the tarballs instead,
// and `requests` lets a case prove that a second run came from the bunx cache.

type FixturePackage = {
  name: string;
  version: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  /** How long ago the version was published. Years, unless given. */
  daysOld?: number;
  /** Contents of the package besides its generated package.json. */
  files: Record<string, string>;
};

/** A bin script that prints `<label>` followed by the arguments it was invoked with. */
function echoBin(label: string): string {
  return `#!/usr/bin/env node\nconsole.log(${JSON.stringify(label)}, ...process.argv.slice(2));\n`;
}

function fixturePackage(
  name: string,
  version: string,
  binName: string,
  binScript: string = echoBin(`${binName} ${version}`),
): FixturePackage {
  return { name, version, bin: { [binName]: "cli.js" }, files: { "cli.js": binScript } };
}

function fixtureServer(handler: (pathname: string) => Uint8Array<ArrayBuffer> | object | undefined) {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      const body = handler(pathname);
      if (body === undefined) return new Response(`no fixture for ${pathname}`, { status: 404 });
      return body instanceof Uint8Array ? new Response(body) : Response.json(body);
    },
  });
  return {
    /** Every request path received so far, in order. */
    requests,
    url: server.url.origin,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

/**
 * An npm registry serving `packages` (the last version listed for a name is its
 * `latest`); point bunx at it with `npm_config_registry: registry.url`.
 */
async function localRegistry(...packages: FixturePackage[]) {
  const manifests = new Map<
    string,
    { name: string; versions: Record<string, object>; time: Record<string, string>; "dist-tags": { latest: string } }
  >();
  const tarballs = new Map<string, Uint8Array<ArrayBuffer>>();
  const registry = fixtureServer(
    pathname => tarballs.get(pathname) ?? manifests.get(decodeURIComponent(pathname.slice(1))),
  );
  for (const { name, version, bin, dependencies, scripts, daysOld = 3650, files } of packages) {
    const tarballPath = `/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`;
    const packageJson = { name, version, bin, dependencies, scripts };
    tarballs.set(
      tarballPath,
      await githubTarball("package", { "package.json": JSON.stringify(packageJson), ...files }),
    );
    const manifest = manifests.get(name) ?? { name, versions: {}, time: {}, "dist-tags": { latest: version } };
    manifest.versions[version] = { ...packageJson, dist: { tarball: `${registry.url}${tarballPath}` } };
    manifest.time[version] = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    manifest["dist-tags"].latest = version;
    manifests.set(name, manifest);
  }
  return Object.assign(registry, {
    /** Moves the `latest` tag of `name`. */
    tagLatest(name: string, version: string) {
      manifests.get(name)!["dist-tags"].latest = version;
    },
  });
}

/**
 * A world of its own for one test. `cwd`, `tmp` ($TMPDIR) and `home` ($HOME) are
 * siblings, as /tmp and a home directory are: nothing in `tmp` is above what bunx
 * keeps below `home`. No variable names the install cache, so it is
 * `home/.bun/install/cache`, as for a real user.
 */
function sandbox(registry?: { url: string; requests: string[] }, files: DirectoryTree = {}) {
  const dir = tempDir("bunx", { cwd: {}, tmp: {}, home: {}, ...files });
  const [cwd, tmp, home] = ["cwd", "tmp", "home"].map(name => join(String(dir), name));
  const cache = join(home, ".bun", "install", "cache");
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    BUN_TMPDIR: tmp,
    HOME: home,
    USERPROFILE: home,
    BUN_INSTALL_CACHE_DIR: undefined,
    BUN_INSTALL: undefined,
    XDG_CACHE_HOME: undefined,
    BUN_OPTIONS: undefined,
    npm_config_registry: registry?.url,
  };
  return {
    dir: String(dir),
    cwd,
    tmp,
    home,
    cache,
    env,
    /** `.bunx-<uid>` in the install cache: what holds every tree on POSIX. */
    root: join(cache, `.bunx-${process.getuid?.()}`),
    /** The directory bunx installs `spec` (`<package>@<version>`) into. */
    tree(spec: string) {
      if (!isWindows) return join(this.root, spec);
      // Found by its name, so that the test does not depend on how the uid is derived.
      const found = readdirSync(tmp).filter(name => name.startsWith("bunx-") && name.endsWith(`-${spec}`));
      expect(found).toHaveLength(1);
      return join(tmp, found[0]);
    },
    /** `bun x ...args` (or `...bunx ...args`). `requests` is what the registry was asked for meanwhile. */
    async run(
      args: string[],
      {
        bunx = [bunExe(), "x"],
        ...options
      }: { bunx?: string[]; env?: Record<string, string | undefined>; uid?: number; gid?: number } = {},
    ) {
      const first = registry?.requests.length ?? 0;
      await using proc = spawn({
        cmd: [...bunx, ...args],
        cwd,
        env,
        ...options,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, requests: registry?.requests.slice(first) ?? [] };
    },
    [Symbol.dispose]() {
      dir[Symbol.dispose]();
    },
  };
}

/** `tool`, whose bin needs its dependency `dep`. 1.1.0 is `latest`. */
function toolWithDep(): FixturePackage[] {
  const tool = (version: string): FixturePackage => ({
    name: "tool",
    version,
    bin: { tool: "cli.js" },
    dependencies: { dep: "1.0.0" },
    files: { "cli.js": `#!/usr/bin/env node\nconsole.log("tool ${version} with " + require("dep"));\n` },
  });
  return [
    { name: "dep", version: "1.0.0", files: { "index.js": `module.exports = "dep 1.0.0";\n` } },
    tool("1.0.0"),
    tool("1.1.0"),
  ];
}

/** Puts a bin called `name` that runs `script` with node into `dir`/node_modules/.bin. */
function addLocalBin(dir: string, name: string, script: string) {
  const bin = join(dir, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  if (isWindows) {
    writeFileSync(join(bin, `${name}.js`), script);
    writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.js" %*\r\n`);
  } else {
    writeFileSync(join(bin, name), `#!/usr/bin/env node\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  }
}

/** Makes everything below `dir`, and what it shares with the install cache through hard links, `hours` old. */
function age(dir: string, hours = 25) {
  const then = new Date(Date.now() - hours * 60 * 60 * 1000);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    (isWindows ? utimesSync : lutimesSync)(join(entry.parentPath, entry.name), then, then);
  }
}

/**
 * An install with `--force` removes each package directory and links it again, so
 * a file added to a package tells whether that happened. Returns which are left.
 */
function plantMarkers(tree: string, ...packages: string[]) {
  const markers = packages.map(name => join(tree, "node_modules", name, "MARKER"));
  for (const marker of markers) writeFileSync(marker, "");
  return () => markers.map(marker => existsSync(marker));
}

/**
 * Stands in for api.github.com (bun install honors `GITHUB_API_URL`): every
 * `/repos/<owner>/<repo>/tarball/<ref>` request gets the one fixture repository.
 */
async function localGithub(owner: string, repo: string, files: Record<string, string>) {
  const bytes = await githubTarball(`${owner}-${repo}-0123abc`, files);
  return fixtureServer(pathname => (pathname.startsWith(`/repos/${owner}/${repo}/tarball/`) ? bytes : undefined));
}

beforeEach(() => {
  // Sequential tests (the mock-registry suites below) still read these module-level vars.
  ({ x_dir, env } = setup());
});

it.concurrent("should choose the tagged versions instead of the PATH versions when a tag is specified", async () => {
  const { x_dir, env } = setup();
  let semverVersions = [
    "7.0.0",
    "7.1.0",
    "7.1.1",
    "7.1.2",
    "7.1.3",
    "7.2.0",
    "7.2.1",
    "7.2.2",
    "7.2.3",
    "7.3.0",
    "7.3.1",
    "7.3.2",
    "7.3.3",
    "7.3.4",
    "7.3.5",
    "7.3.6",
    "7.3.7",
    "7.3.8",
    "7.4.0",
    "7.5.0",
    "7.5.1",
    "7.5.2",
    "7.5.3",
    "7.5.4",
    "7.6.0",
  ].sort();
  if (isWindows) {
    // Windows does not support race-free installs.
    semverVersions = semverVersions.slice(0, 2);
  }

  // Like the real 7.5+ versions (which share lru-cache), every version depends
  // on one shared package, so the simultaneous installs below also race to
  // extract the same dependency into the shared install cache. Not on Windows:
  // two installs extracting the same package there fail with "ENOENT: failed
  // opening cache/package/version dir" roughly half the time, and the real
  // 7.0.0 and 7.1.0 that Windows runs have no dependencies either.
  using registry = await localRegistry(
    { name: "lru-cache", version: "1.0.0", files: { "index.js": "" } },
    ...semverVersions.map(version => ({
      ...fixturePackage("semver", version, "semver"),
      ...(!isWindows && { dependencies: { "lru-cache": "1.0.0" } }),
    })),
  );

  // A `semver` that is first in PATH must lose to the explicitly requested versions.
  using decoyBinDir = tempDir(
    "bunx-decoy-bin",
    isWindows ? { "semver.cmd": "@echo semver from PATH\r\n" } : { "semver": '#!/bin/sh\necho "semver from PATH"\n' },
  );
  if (!isWindows) chmodSync(join(String(decoyBinDir), "semver"), 0o755);

  const processes = semverVersions.map(version => {
    return spawn({
      cmd: [bunExe(), "x", "semver@" + version, "--help"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: {
        ...env,
        npm_config_registry: registry.url,
        PATH: `${decoyBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      },
    });
  });

  const results = await Promise.all(
    processes.map(async (subprocess, i) => {
      const [stdout, stderr, exitCode] = await Promise.all([
        subprocess.stdout.text(),
        subprocess.stderr.text(),
        subprocess.exited,
      ]);
      return { version: semverVersions[i], stdout: stdout.trim(), stderr, exitCode };
    }),
  );
  expect(results).toEqual(
    semverVersions.map(version => ({
      version,
      stdout: `semver ${version} --help`,
      stderr: expect.not.stringContaining("error:"),
      exitCode: 0,
    })),
  );
});

// Two versions of a package whose bin (`uglifyjs`, as in the real uglify-js) is
// not named after the package, so bunx has to read the installed package.json to
// find it. 3.19.3 is `latest`; `latestBin` replaces its bin script.
function uglifyJs(latestBin?: string): FixturePackage[] {
  return [
    fixturePackage("uglify-js", "3.14.1", "uglifyjs"),
    fixturePackage("uglify-js", "3.19.3", "uglifyjs", latestBin),
  ];
}

it.concurrent("should install and run default (latest) version", async () => {
  const { x_dir, env } = setup();
  using registry = await localRegistry(
    ...uglifyJs(
      `#!/usr/bin/env node\nconsole.log("uglifyjs 3.19.3", ...process.argv.slice(2), "stdin:", require("fs").readFileSync(0, "utf8"));\n`,
    ),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js", "--compress"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: new TextEncoder().encode("console.log(6 * 7);"),
    stderr: "pipe",
    env: { ...env, npm_config_registry: registry.url },
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(out.trim()).toBe("uglifyjs 3.19.3 --compress stdin: console.log(6 * 7);");
  expect(registry.requests).toEqual(["/uglify-js", "/uglify-js/-/uglify-js-3.19.3.tgz"]);
  expect(exitCode).toBe(0);
});

it.concurrent("should install and run specified version", async () => {
  const { x_dir, env } = setup();
  using registry = await localRegistry(...uglifyJs());
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js@3.14.1", "-v"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: { ...env, npm_config_registry: registry.url },
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(out.trim()).toBe("uglifyjs 3.14.1 -v");
  expect(registry.requests).toEqual(["/uglify-js", "/uglify-js/-/uglify-js-3.14.1.tgz"]);
  expect(exitCode).toBe(0);
});

it.concurrent("should output usage if no arguments are passed", async () => {
  const { x_dir, env } = setup();
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Usage: ");
  const out = await stdout.text();
  expect(out).toHaveLength(0);
  expect(await exited).toBe(1);
});

it.concurrent("should work for @scoped packages", async () => {
  const { x_dir, env } = setup();
  // Like @babel/cli -> `babel`: the bin is named after neither the scope nor the
  // package, so bunx has to read the installed package.json to find it.
  using registry = await localRegistry(fixturePackage("@bunx-fixture/cli", "1.2.3", "scoped-cli"));
  const run = () => {
    const subprocess = spawn({
      cmd: [bunExe(), "--bun", "x", "@bunx-fixture/cli", "--help"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: { ...env, npm_config_registry: registry.url },
    });
    return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
  };

  // without cache
  {
    const [err, out, exited] = await run();
    expect(err).not.toContain("error:");
    expect(out.trim()).toBe("scoped-cli 1.2.3 --help");
    expect(exited).toBe(0);
  }
  expect(registry.requests).toEqual(["/@bunx-fixture%2fcli", "/@bunx-fixture/cli/-/cli-1.2.3.tgz"]);

  // cached: the second run must come from the bunx cache without touching the registry
  {
    const [err, out, exited] = await run();
    expect(err).toBe("");
    expect(out.trim()).toBe("scoped-cli 1.2.3 --help");
    expect(exited).toBe(0);
  }
  expect(registry.requests).toHaveLength(2);
});

it.concurrent("should execute from current working directory", async () => {
  const { x_dir, env } = setup();
  await writeFile(
    join(x_dir, "test.js"),
    `
console.log(
6
*
7
)`,
  );
  // The bin resolves its argument against the directory it was started in.
  using registry = await localRegistry(
    ...uglifyJs(
      `#!/usr/bin/env node\nconsole.log("uglifyjs 3.19.3 read", process.argv[2] + ":", require("fs").readFileSync(process.argv[2], "utf8").replace(/\\s+/g, ""));\n`,
    ),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "--bun", "x", "uglify-js", "test.js", "--compress"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: { ...env, npm_config_registry: registry.url },
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  // bunx installed into its cache dir, not into the directory it was run from
  expect(await readdirSorted(x_dir)).toEqual(["test.js"]);
  expect(out.trim()).toBe("uglifyjs 3.19.3 read test.js: console.log(6*7)");
  expect(exitCode).toBe(0);
});

// `bunx github:<owner>/<repo>` guesses the bin from the repository name, so the
// fixture repository is named after its bin, like piuccio/cowsay -> `cowsay`.
const cowsayRepo = {
  "package.json": JSON.stringify({ name: "cowsay", version: "1.0.0", bin: { cowsay: "cli.js" } }),
  "cli.js": echoBin("cowsay from github"),
};

it.concurrent("should work for github repository", async () => {
  const { x_dir, env } = setup();
  using github = await localGithub("bunx-fixture", "cowsay", cowsayRepo);
  const run = () => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", "github:bunx-fixture/cowsay", "--help"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: { ...env, GITHUB_API_URL: github.url },
    });
    return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
  };

  // without cache
  {
    const [err, out, exited] = await run();
    expect(err).not.toContain("error:");
    expect(out.trim()).toBe("cowsay from github --help");
    expect(exited).toBe(0);
  }
  expect(github.requests).toEqual(["/repos/bunx-fixture/cowsay/tarball/"]);

  // cached
  {
    const [err, out, exited] = await run();
    expect(err).toBe("");
    expect(out.trim()).toBe("cowsay from github --help");
    expect(exited).toBe(0);
  }
  expect(github.requests).toHaveLength(1);
});

it.concurrent("should work for github repository with committish", async () => {
  const { x_dir, env } = setup();
  using github = await localGithub("bunx-fixture", "cowsay", cowsayRepo);
  const run = (...flags: string[]) => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...flags, "github:bunx-fixture/cowsay#HEAD", "hello bun!"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: { ...env, GITHUB_API_URL: github.url },
    });
    return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
  };

  {
    const [err, out, exited] = await run();
    expect(err).not.toContain("error:");
    expect(out.trim()).toBe("cowsay from github hello bun!");
    expect(exited).toBe(0);
  }
  expect(github.requests).toEqual(["/repos/bunx-fixture/cowsay/tarball/HEAD"]);

  // cached
  {
    const [err, out, exited] = await run("--no-install");
    expect(err).toBe("");
    expect(out.trim()).toBe("cowsay from github hello bun!");
    expect(exited).toBe(0);
  }
  expect(github.requests).toHaveLength(1);
});

it.concurrent.each(["--version", "-v"])("should print the version using %s and exit", async flag => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", flag],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(exited).toBe(0);
});

it.concurrent("should print the revision and exit", async () => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", "--revision"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(out.trim()).toContain(Bun.revision.slice(0, 7));
  expect(exited).toBe(0);
});

it.concurrent("should pass --version to the package if specified", async () => {
  const { x_dir, env } = setup();
  using registry = await localRegistry(fixturePackage("esbuild", "0.28.2", "esbuild"));
  const subprocess = spawn({
    cmd: [bunExe(), "x", "esbuild", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: {
      ...env,
      npm_config_registry: registry.url,
      // unversioned, so an esbuild already on PATH would be run instead of the fixture
      PATH: pathWithout("esbuild", env.PATH ?? process.env.PATH),
    },
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  // the flag reached the package instead of being taken as bunx's own --version
  expect(out.trim()).toBe("esbuild 0.28.2 --version");
  expect(exited).toBe(0);
});

it.concurrent('should set "npm_config_user_agent" to bun', async () => {
  const { x_dir, env } = setup();
  await writeFile(
    join(x_dir, "package.json"),
    JSON.stringify({
      dependencies: {
        "print-pm": resolve(import.meta.dir, "print-pm-1.0.0.tgz"),
      },
    }),
  );

  const { exited: installFinished } = spawn({
    cmd: [bunExe(), "install"],
    cwd: x_dir,
    env,
  });
  expect(await installFinished).toBe(0);

  const subprocess = spawn({
    cmd: [bunExe(), "x", "print-pm"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(`bun/${Bun.version}`);
  expect(exited).toBe(0);
});

/**
 * IMPORTANT
 * Please only use packages with small unpacked sizes for tests. It helps keep them fast.
 */
describe("bunx --no-install", () => {
  const run = (
    ctx: { x_dir: string; env: Record<string, string> },
    ...args: string[]
  ): Promise<[stderr: string, stdout: string, exitCode: number]> => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...args],
      cwd: ctx.x_dir,
      env: ctx.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
  };

  it.concurrent("if the package is not installed, it should fail and print an error message", async () => {
    const ctx = setup();
    const [err, out, exited] = await run(ctx, "--no-install", "http-server", "--version");

    expect(err.trim()).toContain("Could not find an existing 'http-server' binary to run.");
    expect(out).toHaveLength(0);
    expect(exited).toBe(1);
  });

  /*
    yes, multiple package tests are neccessary.
      1. there's specialized logic for `bunx tsc` and `bunx typescript`
      2. http-server checks for non-alphanumeric edge cases. Plus it's small
      3. eslint is alphanumeric and extremely common
   */
  it.concurrent.each(["typescript", "http-server", "eslint"])(
    "`bunx --no-install %s` should find cached packages",
    async pkg => {
      const bin = pkg === "typescript" ? "tsc" : pkg;
      using registry = await localRegistry(fixturePackage(pkg, "1.0.0", bin));
      const ctx = setup();
      ctx.env.npm_config_registry = registry.url;
      // An unversioned `bunx <pkg>` runs a matching bin from PATH before it looks
      // at its cache, so a tsc/eslint/http-server installed on this machine
      // would satisfy both runs without the cache ever being consulted.
      // (bunEnv spreads process.env, whose key is `Path` on Windows.)
      ctx.env.PATH = pathWithout(bin, ctx.env.PATH ?? process.env.PATH);

      // not cached
      {
        const [err, out, code] = await run(ctx, pkg, "--version");
        expect(err).not.toContain("error:");
        expect(out.trim()).toBe(`${bin} 1.0.0 --version`);
        expect(code).toBe(0);
      }
      expect(registry.requests).toEqual([`/${pkg}`, `/${pkg}/-/${pkg}-1.0.0.tgz`]);

      // cached
      {
        const [err, out, code] = await run(ctx, "--no-install", pkg, "--version");
        expect(err).toBe("");
        expect(out.trim()).toBe(`${bin} 1.0.0 --version`);
        expect(code).toBe(0);
      }
      expect(registry.requests).toHaveLength(2);
    },
  );

  it.concurrent("when an exact version match is found, should find cached packages", async () => {
    using registry = await localRegistry(fixturePackage("http-server", "14.0.0", "http-server"));
    const ctx = setup();
    ctx.env.npm_config_registry = registry.url;

    // not cached
    {
      const [err, out, code] = await run(ctx, "http-server@14.0.0", "--version");
      expect(err).not.toContain("error:");
      expect(out.trim()).toBe("http-server 14.0.0 --version");
      expect(code).toBe(0);
    }
    expect(registry.requests).toEqual(["/http-server", "/http-server/-/http-server-14.0.0.tgz"]);

    // cached
    {
      const [err, out, code] = await run(ctx, "--no-install", "http-server@14.0.0", "--version");
      expect(err).toBe("");
      expect(out.trim()).toBe("http-server 14.0.0 --version");
      expect(code).toBe(0);
    }
    expect(registry.requests).toHaveLength(2);
  });
});

it.concurrent("should handle postinstall scripts correctly with symlinked bunx", async () => {
  const { x_dir, env } = setup();
  // Copies rather than symlinks: bun re-runs its own executable path for the
  // install (`bunx add`) and for lifecycle scripts (`bunx exec`), and #17076 was
  // those being taken for packages named "add"/"exec" when that path ends in bunx.
  copyFileSync(bunExe(), join(x_dir, isWindows ? "bun.exe" : "bun"));
  copyFileSync(bunExe(), join(x_dir, isWindows ? "bunx.exe" : "bunx"));

  // esbuild is in bun's default trusted dependencies, so its postinstall runs.
  // The bin reports whether it did.
  using registry = await localRegistry({
    name: "esbuild",
    version: "0.28.2",
    bin: { esbuild: "cli.js" },
    scripts: { postinstall: "node postinstall.js" },
    files: {
      "postinstall.js": `require("fs").writeFileSync("postinstall-ran", "");\n`,
      "cli.js": `#!/usr/bin/env node\nconsole.log("esbuild 0.28.2", require("fs").existsSync(__dirname + "/postinstall-ran") ? "after postinstall" : "without postinstall", ...process.argv.slice(2));\n`,
    },
  });

  const subprocess = spawn({
    cmd: ["bunx", "esbuild@latest", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: {
      ...env,
      npm_config_registry: registry.url,
      PATH: `${x_dir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
    },
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(err).not.toContain("Cannot find module 'exec'");
  expect(out.trim()).toBe("esbuild 0.28.2 after postinstall --version");
  expect(registry.requests).toEqual(["/esbuild", "/esbuild/-/esbuild-0.28.2.tgz"]);
  expect(exited).toBe(0);
});

// Stands in for `bunx --bun @angular/cli`, whose `ng` refuses to start on a
// Node.js older than its engines range (Bun used to self-report 22.6.0 and
// fail it). The fixture applies the same gate to the version Bun reports under
// --bun; installing the real CLI pulled in ~250 packages per run, and its
// engines range moved under us twice.
it.concurrent("should handle package that requires node 24", async () => {
  const { x_dir, env } = setup();
  using registry = await localRegistry({
    name: "@bunx-fixture/requires-node-24",
    version: "1.0.0",
    bin: { ng: "cli.js" },
    files: {
      "cli.js": `#!/usr/bin/env node
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error("error: Node.js v" + process.versions.node + " is not supported, v24 or newer is required");
  process.exit(3);
}
console.log("node v" + process.versions.node + " running in " + (typeof Bun === "undefined" ? "node" : "bun"));
`,
    },
  });
  const subprocess = spawn({
    cmd: [bunExe(), "x", "--bun", "@bunx-fixture/requires-node-24", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: { ...env, npm_config_registry: registry.url },
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);
  expect(err).not.toContain("error:");
  // --bun ran the bin with this same Bun, so it saw the version Bun reports as Node.js
  expect(out.trim()).toBe(`node v${process.versions.node} running in bun`);
  expect(exited).toBe(0);
});

describe("--package flag", () => {
  const run = async (...args: string[]): Promise<[err: string, out: string, exited: number]> => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...args],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    return [err, out, exited];
  };

  it("should error when --package is provided without package name", async () => {
    const [err, out, exited] = await run("--package");
    expect(err).toContain("--package requires a package name");
    expect(exited).toBe(1);
  });

  it("should error when --package is provided without binary name", async () => {
    const [err, out, exited] = await run("--package", "some-package");
    expect(err).toContain("When using --package, you must specify the binary to run");
    expect(exited).toBe(1);
  });

  describe("with mock registry", () => {
    let port: number;

    beforeAll(() => {
      dummyBeforeAll();
      port = getPort()!;
    });

    afterAll(() => {
      dummyAfterAll();
    });

    beforeEach(async () => {
      await dummyBeforeEach();
    });

    const runWithRegistry = async (
      ...args: string[]
    ): Promise<[err: string, out: string, exited: number, urls: string[]]> => {
      const urls: string[] = [];

      const subprocess = spawn({
        cmd: [bunExe(), "x", ...args],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      return [err, out, exited, urls];
    };

    it("should install specified package when binary differs from package name", async () => {
      const urls: string[] = [];

      // Set up dummy registry with a package that has a different binary name
      setHandler(
        dummyRegistry(urls, {
          "1.0.0": {
            bin: {
              "different-bin": "index.js",
            },
            as: "1.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      // Without --package, bunx different-bin would fail
      // With --package, we correctly install my-special-pkg
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package", "my-special-pkg", "different-bin", "--help"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/my-special-pkg"))).toBe(true);
      // The package should install successfully
      expect(err).toContain("Saved lockfile");
    });

    it("should support -p shorthand with mock registry", async () => {
      const urls: string[] = [];

      setHandler(
        dummyRegistry(urls, {
          "2.0.0": {
            bin: {
              "tool": "cli.js",
            },
            as: "2.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      const subprocess = spawn({
        cmd: [bunExe(), "x", "-p", "actual-package", "tool", "--version"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/actual-package"))).toBe(true);
    });

    it("should support --package=<pkg> syntax with mock registry", async () => {
      const urls: string[] = [];

      setHandler(
        dummyRegistry(urls, {
          "3.0.0": {
            bin: {
              "runner": "run.js",
            },
            as: "3.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package=runner-pkg", "runner", "--help"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/runner-pkg"))).toBe(true);
    });

    it("should fail to run alternate binary without --package flag", async () => {
      // Attempt to run multi-tool-alt without --package flag
      // This should fail because bunx would try to install a package named "multi-tool-alt"
      const subprocess = spawn({
        cmd: [bunExe(), "x", "multi-tool-alt"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, _out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      // Should fail because there's no package named "multi-tool-alt"
      expect(err).toContain("error:");
      expect(exited).not.toBe(0);
    });

    it("should execute the correct binary when package has multiple binaries", async () => {
      const urls: string[] = [];

      // Create the tarball with both binaries that output different messages
      // First, let's create the package structure
      const tempDir = tmpdirSync();
      const packageDir = join(tempDir, "package");

      await Bun.$`mkdir -p ${packageDir}/bin`;

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "multi-tool-pkg",
          version: "1.0.0",
          bin: {
            "multi-tool": "bin/multi-tool.js",
            "multi-tool-alt": "bin/multi-tool-alt.js",
          },
        }),
      );

      await writeFile(
        join(packageDir, "bin", "multi-tool.js"),
        `#!/usr/bin/env node
console.log("EXECUTED: multi-tool (main binary)");
`,
      );

      await writeFile(
        join(packageDir, "bin", "multi-tool-alt.js"),
        `#!/usr/bin/env node
console.log("EXECUTED: multi-tool-alt (alternate binary)");
`,
      );

      // Make the binaries executable
      await Bun.$`chmod +x ${packageDir}/bin/multi-tool.js ${packageDir}/bin/multi-tool-alt.js`;

      // Create the tarball with package/ prefix. It goes to a temp dir the
      // registry is pointed at — writing it under import.meta.dir would
      // rewrite a checked-in file on every run.
      const tgzDir = tmpdirSync();
      await Bun.$`cd ${tempDir} && tar -czf ${join(tgzDir, "multi-tool-pkg-1.0.0.tgz")} package`;

      setHandler(
        dummyRegistry(
          urls,
          {
            "1.0.0": {
              bin: {
                "multi-tool": "bin/multi-tool.js",
                "multi-tool-alt": "bin/multi-tool-alt.js",
              },
              as: "1.0.0",
            },
          },
          0,
          tgzDir,
        ),
      );

      // Test 1: Without --package, bunx multi-tool-alt should fail or install wrong package
      // Test 2: With --package, we can run the alternate binary
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package", "multi-tool-pkg", "multi-tool-alt"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [_err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      // Verify the correct package was requested
      expect(urls.some(url => url.includes("/multi-tool-pkg"))).toBe(true);

      // Verify the correct binary was executed
      expect(out).toContain("EXECUTED: multi-tool-alt (alternate binary)");
      expect(out).not.toContain("EXECUTED: multi-tool (main binary)");
      expect(exited).toBe(0);
    });
  });
});

// Regression: `bunx @scope/name` guesses the bin name as `name` (the
// unscoped portion), then searched the full system $PATH with it. When
// `name` happened to match an unrelated system binary — e.g.
// `bunx @uidotsh/install` matching /usr/bin/install — the system binary
// was executed instead of the package's actual bin.
describe("scoped packages should not match unrelated system binaries", () => {
  let port: number;

  beforeAll(() => {
    dummyBeforeAll();
    port = getPort()!;
  });

  afterAll(() => {
    dummyAfterAll();
  });

  beforeEach(async () => {
    await dummyBeforeEach();
  });

  it("`bunx @scope/install` runs the package's bin, not a system binary named `install`", async () => {
    // Create a scoped package whose bin name does NOT match the unscoped
    // portion of the package name, mirroring @uidotsh/install whose bin is
    // "uidotsh-installer".
    const pkgRoot = tmpdirSync();
    const packageDir = join(pkgRoot, "package");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/install",
        version: "1.0.0",
        bin: { "scoped-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(packageDir, "cli.js"),
      `#!/usr/bin/env node\nconsole.log("CORRECT: ran the scoped package's bin");\n`,
    );
    const tgzDir = tmpdirSync();
    // The dummy registry serves the tarball by basename of the request URL,
    // which for `@scope/install` + version 1.0.0 is `install-1.0.0.tgz`.
    await Bun.$`tar -czf ${join(tgzDir, "install-1.0.0.tgz")} -C ${pkgRoot} package`;

    // Create a fake "install" binary in $PATH to simulate /usr/bin/install.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "install.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "install");
      await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
      await Bun.$`chmod +x ${fakeBin}`;
    }

    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "1.0.0": { bin: { "scoped-tool": "cli.js" }, as: "1.0.0" } }, 0, tgzDir));

    const subprocess = spawn({
      cmd: [bunExe(), "x", "@scope/install"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        npm_config_registry: `http://localhost:${port}/`,
        PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      },
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out).not.toContain("WRONG");
    expect(err).not.toContain("WRONG");
    expect(out).toContain("CORRECT: ran the scoped package's bin");
    expect(exited).toBe(0);
  });

  // Also covers https://github.com/oven-sh/bun/issues/19458 and
  // https://github.com/oven-sh/bun/issues/17904: when a scoped package is
  // already installed locally, bunx must read its package.json (under the
  // full scoped name) to discover the real bin name, instead of guessing
  // the unscoped basename and tripping over a system binary.
  it("locally installed `@scope/name` resolves the real bin from its package.json", async () => {
    await mkdir(join(x_dir, "node_modules", "@myscope", "collide"), { recursive: true });
    await mkdir(join(x_dir, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "collide", "package.json"),
      JSON.stringify({ name: "@myscope/collide", version: "1.0.0", bin: { "real-bin": "./real.js" } }),
    );
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "collide", "real.js"),
      `#!/usr/bin/env node\nconsole.log("REAL_BIN_RAN");\n`,
    );
    if (isWindows) {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "real-bin.cmd"),
        `@echo off\r\nnode "%~dp0..\\@myscope\\collide\\real.js" %*\r\n`,
      );
    } else {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "real-bin"),
        `#!/usr/bin/env node\nrequire("../@myscope/collide/real.js");\n`,
      );
      chmodSync(join(x_dir, "node_modules", "@myscope", "collide", "real.js"), 0o755);
      chmodSync(join(x_dir, "node_modules", ".bin", "real-bin"), 0o755);
    }

    // Put a decoy named after the unscoped basename ("collide") in $PATH.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "collide.cmd"), `@echo off\r\necho DECOY_RAN\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "collide");
      await writeFile(fakeBin, `#!/bin/sh\necho DECOY_RAN\n`);
      chmodSync(fakeBin, 0o755);
    }

    const subprocess = spawn({
      cmd: [bunExe(), "x", "--no-install", "@myscope/collide"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      },
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out.trim()).toBe("REAL_BIN_RAN");
    expect(out).not.toContain("DECOY_RAN");
    expect(err).not.toContain("error:");
    expect(exited).toBe(0);
  });

  // When a scoped package's bin name happens to match its unscoped
  // basename (e.g. `@scope/foo` with bin `foo`), the first $PATH probe —
  // which excludes the system $PATH for scoped packages but still searches
  // node_modules/.bin — should find the locally-linked bin.
  it("locally installed `@scope/foo` whose bin is also named `foo` is still found", async () => {
    await mkdir(join(x_dir, "node_modules", "@myscope", "samebin"), { recursive: true });
    await mkdir(join(x_dir, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "samebin", "package.json"),
      JSON.stringify({ name: "@myscope/samebin", version: "1.0.0", bin: { samebin: "./real.js" } }),
    );
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "samebin", "real.js"),
      `#!/usr/bin/env node\nconsole.log("SAMEBIN_RAN");\n`,
    );
    if (isWindows) {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "samebin.cmd"),
        `@echo off\r\nnode "%~dp0..\\@myscope\\samebin\\real.js" %*\r\n`,
      );
    } else {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "samebin"),
        `#!/usr/bin/env node\nrequire("../@myscope/samebin/real.js");\n`,
      );
      chmodSync(join(x_dir, "node_modules", "@myscope", "samebin", "real.js"), 0o755);
      chmodSync(join(x_dir, "node_modules", ".bin", "samebin"), 0o755);
    }

    const subprocess = spawn({
      cmd: [bunExe(), "x", "--no-install", "@myscope/samebin"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out.trim()).toBe("SAMEBIN_RAN");
    expect(err).not.toContain("error:");
    expect(exited).toBe(0);
  });

  // When a scoped package lives only in the bunx cache (not locally
  // installed) and its real bin name — discovered by reading its
  // package.json — collides with a system binary, bunx must run the
  // cached bin via the absolute-path probe, not the system binary.
  it("bunx-cache-only `@scope/name` whose real bin collides with a system binary runs the cached bin", async () => {
    // Create a scoped package with a bin name that differs from the
    // unscoped portion AND collides with a system binary we control.
    const pkgRoot = tmpdirSync();
    const packageDir = join(pkgRoot, "package");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@cacheonly/pkg",
        version: "1.0.0",
        bin: { "colliding-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(packageDir, "cli.js"),
      `#!/usr/bin/env node\nconsole.log("CORRECT: ran the cached package's bin");\n`,
    );
    const tgzDir = tmpdirSync();
    await Bun.$`tar -czf ${join(tgzDir, "pkg-1.0.0.tgz")} -C ${pkgRoot} package`;

    // Put a decoy "colliding-tool" (the REAL bin name) in $PATH.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "colliding-tool.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "colliding-tool");
      await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
      chmodSync(fakeBin, 0o755);
    }

    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "1.0.0": { bin: { "colliding-tool": "cli.js" }, as: "1.0.0" } }, 0, tgzDir));

    const runEnv = {
      ...env,
      npm_config_registry: `http://localhost:${port}/`,
      PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
    };

    // First run: installs into the bunx cache (no local node_modules).
    {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "@cacheonly/pkg"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: runEnv,
      });
      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);
      expect(out).not.toContain("WRONG");
      expect(err).not.toContain("WRONG");
      expect(out).toContain("CORRECT: ran the cached package's bin");
      expect(exited).toBe(0);
    }

    // Second run with --no-install: must resolve the real bin name from
    // the cached package.json and run the cached bin, NOT the colliding
    // system binary.
    {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", "@cacheonly/pkg"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: runEnv,
      });
      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);
      expect(out).not.toContain("WRONG");
      expect(err).not.toContain("WRONG");
      expect(out).toContain("CORRECT: ran the cached package's bin");
      expect(exited).toBe(0);
    }
  });
});

describe("package name aliases", () => {
  let port: number;

  beforeAll(() => {
    dummyBeforeAll();
    port = getPort()!;
  });

  afterAll(() => {
    dummyAfterAll();
  });

  beforeEach(async () => {
    await dummyBeforeEach();
  });

  // `bunx claude` should resolve to `@anthropic-ai/claude-code` (same shape as
  // the `tsc` -> `typescript` rewrite). The npm package named `claude` is an
  // unrelated squatter with no bin, so redirecting is strictly more useful.
  it("`bunx claude` requests @anthropic-ai/claude-code, not the 'claude' squatter", async () => {
    const urls: string[] = [];
    setHandler(async request => {
      urls.push(request.url);
      return new Response("{}", { status: 404 });
    });

    const subprocess = spawn({
      cmd: [bunExe(), "x", "claude", "--version"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        // An untagged `bunx <name>` runs a matching binary already on PATH
        // instead of querying the registry, so a machine with `claude`
        // installed never makes the request this test asserts on. Drop those
        // entries so the alias is what gets exercised, not the developer's or
        // the agent's PATH.
        PATH: pathWithout("claude", env.PATH),
        npm_config_registry: `http://localhost:${port}/`,
      },
    });

    const [, , exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

    const paths = urls.map(u => new URL(u).pathname);
    // The manifest request must be for the real package, and must never hit
    // the squatter package name.
    expect(paths).toContain("/@anthropic-ai%2fclaude-code");
    expect(paths).not.toContain("/claude");
    // Install fails because the mock registry 404s; that's fine, we only care
    // about which manifest was requested.
    expect(exited).not.toBe(0);
  });
});

// Regression test: bunx should not crash on corrupted .bunx files (Windows only)
// When the .bunx metadata file is corrupted (e.g., missing quote terminator in bin_path),
// bunx should gracefully fall back to the slow path instead of panicking.
it.skipIf(!isWindows)("should not crash on corrupted .bunx file with missing quote", async () => {
  // Installing any package with a bin creates the tsc.exe + tsc.bunx pair; the
  // .bunx contents are overwritten below, so a fixture is as good as the real thing.
  using registry = await localRegistry(fixturePackage("typescript", "5.0.0", "tsc"));
  await writeFile(join(x_dir, "package.json"), "{}");
  const subprocess1 = spawn({
    cmd: [bunExe(), "add", "typescript@5.0.0"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, npm_config_registry: registry.url },
  });
  const [err1, out1, exitCode1] = await Promise.all([
    subprocess1.stderr.text(),
    subprocess1.stdout.text(),
    subprocess1.exited,
  ]);
  expect(err1).not.toContain("error:");
  expect(out1).toContain("installed typescript@5.0.0");
  expect(exitCode1).toBe(0);

  // Find the .bunx file
  const binDir = join(x_dir, "node_modules", ".bin");
  const bunxFile = join(binDir, "tsc.bunx");

  // Verify the file exists before corrupting it
  expect(await Bun.file(bunxFile).exists()).toBe(true);

  // Create a corrupted .bunx file:
  // Valid format: [bin_path UTF-16LE]["(quote)][null][shebang][bin_len u32][args_len u32][flags u16]
  // Corrupted: Replace the quote with 'X' but keep valid lengths/flags
  const binPath = Buffer.from("typescript\\bin\\tsc", "utf16le");
  const corruptedQuote = Buffer.from("X", "utf16le"); // 'X' instead of '"'
  const nullChar = Buffer.alloc(2, 0);
  const shebang = Buffer.from("node ", "utf16le");
  const binLen = Buffer.alloc(4);
  binLen.writeUInt32LE(binPath.length);
  const argsLen = Buffer.alloc(4);
  argsLen.writeUInt32LE(shebang.length);
  // Valid flags with has_shebang=true, is_node_or_bun=true, version=v5
  const flags = Buffer.alloc(2);
  flags.writeUInt16LE(0xab37);

  const corruptedData = Buffer.concat([binPath, corruptedQuote, nullChar, shebang, binLen, argsLen, flags]);
  await writeFile(bunxFile, corruptedData);

  // `bun run tsc` first tries to launch the bin in-process from the .bunx
  // metadata (the BunXFastPath). On corrupt metadata it must fall through to
  // spawning tsc.exe, whose standalone copy of the same parser reports the
  // corruption and exits 255; bun then reports that exit like any other bin's.
  const subprocess2 = spawn({
    cmd: [bunExe(), "run", "tsc", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderr, stdout, exitCode] = await Promise.all([
    subprocess2.stderr.text(),
    subprocess2.stdout.text(),
    subprocess2.exited,
  ]);

  expect(stderr).toContain("bin metadata is corrupt");
  expect(stderr).toContain('"tsc.exe" exited with code');
  expect(stdout).toBe("");
  expect(exitCode).toBe(255);
});

// `bun completions` on Windows installs bunx.exe as a hard link to the running
// bun.exe, and a bunx.cmd wrapper where that fails (exFAT, network shares). A
// directory at the bunx.exe path blocks both the delete and the hard link.
it.concurrent.skipIf(!isWindows)("completions: writes bunx.cmd (not bunx.exe) when the hard link fails", async () => {
  const bunxName = isDebug ? "bunx-debug" : "bunx";
  using dir = tempDir("bunx-cmd", { [`${bunxName}.exe`]: {} });
  const bunCopy = join(String(dir), "bun-copy.exe");
  await copyFile(bunExe(), bunCopy);

  await using proc = spawn({
    cmd: [bunCopy, "completions"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // stderr always says that PowerShell completions are not written yet.
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(await Bun.file(join(String(dir), `${bunxName}.cmd`)).text()).toBe("@%~dp0bun.exe x %*\n");
  expect(statSync(join(String(dir), `${bunxName}.exe`)).isDirectory()).toBe(true);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
});

// On POSIX bunx keeps what it installs in <install cache>/.bunx-<uid>/<package>@<version>.
// `require`, the dynamic loader and the tsconfig lookup walk from an installed
// file toward `/` and take what they find, so the tree must not sit below a
// directory where other users can create files, which the temp directory is.
// `.bunx-<uid>` is the trust boundary: a directory of this user with mode 0700.
// Windows keeps %TEMP%\bunx-<uid>-<package>@<version>: %TEMP% is per user.
describe.skipIf(isWindows)("cache directory", () => {
  const uid = process.getuid?.() ?? 0;
  const ran = "tool 1.1.0 with dep 1.0.0\n";
  const bunxEntries = (dir: string) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(name => name.includes("bunx"));

  it.concurrent("is a private directory in the install cache", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);

    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(statSync(box.root).mode & 0o777).toBe(0o700);
    expect(readdirSync(box.root).sort()).toEqual(["tool@latest", "tool@latest.lock"]);
    expect(bunxEntries(box.tmp)).toEqual([]);

    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, stderr: "", exitCode: 0, requests: [] });
  });

  it.concurrent("a module that another user puts in the temp directory is not loaded", async () => {
    using registry = await localRegistry(
      fixturePackage(
        "tool",
        "1.0.0",
        "tool",
        // How a CLI probes for an optional dependency.
        `#!/usr/bin/env node\nlet helper = "none";\ntry {\n  helper = require("zz-optional");\n} catch {}\nconsole.log("helper: " + helper);\n`,
      ),
    );
    using box = sandbox(registry, {
      tmp: { node_modules: { "zz-optional": { "index.js": `module.exports = "planted";\n` } } },
    });

    expect(await box.run(["tool"])).toMatchObject({ stdout: "helper: none\n", exitCode: 0 });
  });

  // The install bunx spawns must not take a directory above the tree for its workspace root.
  it.concurrent.each([
    ["tmp", "{ malformed"],
    ["home", "{ malformed"],
    ["home", JSON.stringify({ name: "home", workspaces: [".bun/install/cache/.bunx-*/*"] })],
  ])("a package.json in %s is nothing to the install: %s", async (where, packageJson) => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry, { [where]: { "package.json": packageJson } });

    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    const installed = readdirSync(join(box.dir, where)).filter(name => name === "node_modules" || name === "bun.lock");
    expect(installed).toEqual([]);
  });

  it.concurrent("a run that does not install writes nothing", async () => {
    using box = sandbox();
    addLocalBin(box.cwd, "local-tool", `console.log("local");`);

    expect(await box.run(["local-tool"])).toMatchObject({ stdout: "local\n", stderr: "", exitCode: 0 });
    expect(await box.run(["--no-install", "absent-tool"])).toMatchObject({ stdout: "", exitCode: 1 });
    expect([bunxEntries(box.home), bunxEntries(box.tmp)]).toEqual([[], []]);
  });

  it.concurrent("a root that is not a private directory of this user is not used", async () => {
    using box = sandbox();
    // What a finished install leaves.
    const bin = join(box.tree("tool@latest"), "node_modules", ".bin", "tool");
    mkdirSync(join(bin, ".."), { recursive: true });
    writeFileSync(join(box.tree("tool@latest"), "package.json"), JSON.stringify({ dependencies: { tool: "^1.0.0" } }));
    writeFileSync(bin, "#!/bin/sh\necho ran out of the cache\n");
    chmodSync(bin, 0o755);

    const used = { stdout: "ran out of the cache\n", stderr: "", exitCode: 0 };
    const notUsed = {
      stdout: "",
      stderr: expect.stringContaining("Could not find an existing 'tool' binary to run."),
      exitCode: 1,
    };

    chmodSync(box.root, 0o700);
    expect(await box.run(["--no-install", "tool"])).toMatchObject(used);

    for (const mode of [0o701, 0o710, 0o755, 0o777]) {
      chmodSync(box.root, mode);
      expect({ mode, ...(await box.run(["--no-install", "tool"])) }).toMatchObject({ mode, ...notUsed });
    }

    // A link to a private directory of this user.
    chmodSync(box.root, 0o700);
    renameSync(box.root, box.root + "-elsewhere");
    symlinkSync(box.root + "-elsewhere", box.root);
    expect(await box.run(["--no-install", "tool"])).toMatchObject(notUsed);

    // A private directory of another user, which only root can make.
    if (uid === 0) {
      rmSync(box.root);
      renameSync(box.root + "-elsewhere", box.root);
      expect(await box.run(["--no-install", "tool"])).toMatchObject(used);
      chownSync(box.root, 65534, 65534);
      expect(await box.run(["--no-install", "tool"])).toMatchObject(notUsed);
    }
  });

  it.concurrent("is in the temp directory, with a warning, while there is no install cache", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    const env = { ...box.env, HOME: undefined, USERPROFILE: undefined };
    const root = join(box.tmp, `.bunx-${uid}`);

    const first = await box.run(["tool"], { env });
    expect(first.stderr).toContain("warn: bunx is installing into the shared temp directory");
    expect(first).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(readdirSync(root).sort()).toEqual(["tool@latest", "tool@latest.lock"]);
    // Not in `node_modules/.bun-cache` of the project, where `bun install` puts its cache then.
    expect(readdirSync(box.cwd)).toEqual([]);

    expect(await box.run(["tool"], { env })).toMatchObject({ stdout: ran, stderr: "", exitCode: 0, requests: [] });

    // The next run that installs takes the install cache, now that there is one.
    const withHome = await box.run(["tool@latest"]);
    expect(withHome.stderr).not.toContain("warn:");
    expect(withHome).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(readdirSync(box.root).sort()).toEqual(["tool@latest", "tool@latest.lock"]);
  });

  it.concurrent("a home directory that cannot be written sends it to the temp directory", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    using unprivileged = unprivilegedSpawnOptions(box.dir);
    chmodSync(box.home, 0o555);

    const first = await box.run(["tool"], unprivileged);
    expect(first.stderr).toContain("warn: bunx is installing into the shared temp directory");
    expect(first).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(bunxEntries(box.tmp)).toContain(`.bunx-${unprivileged.uid ?? uid}`);

    // What the first run installed is found again.
    expect(await box.run(["tool"], unprivileged)).toMatchObject({
      stdout: ran,
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  it.concurrent("refuses to install when no root can be made private", async () => {
    using registry = await localRegistry(...toolWithDep());
    // What any user can put into a shared temp directory.
    using box = sandbox(registry, { tmp: { [`.bunx-${uid}`]: {} } });
    chmodSync(join(box.tmp, `.bunx-${uid}`), 0o777);

    const result = await box.run(["tool"], { env: { ...box.env, HOME: undefined, USERPROFILE: undefined } });
    expect(result.stderr).toContain(
      "error: bunx could not create a cache directory that only the current user can access. Set BUN_INSTALL_CACHE_DIR to a directory you own.",
    );
    expect(result).toMatchObject({ stdout: "", exitCode: 1, requests: [] });
    expect(readdirSync(join(box.tmp, `.bunx-${uid}`))).toEqual([]);
  });

  it.concurrent("a version with .. in it does not lead out of the root", async () => {
    using registry = await localRegistry();
    using box = sandbox(registry);

    // The folder does not exist: what counts is where bunx tried to install it.
    expect((await box.run(["tool@../../escaped"])).exitCode).not.toBe(0);
    expect(readdirSync(box.cache)).not.toContain("escaped");
    expect(readdirSync(box.root).sort()).toEqual([
      expect.stringMatching(/^tool@\w+@\d+$/),
      expect.stringMatching(/^tool@\w+@\d+\.lock$/),
    ]);
  });

  it.concurrent("bun pm cache rm clears and counts every layout", async () => {
    const tree = { node_modules: { ".bin": { tool: "" } } };
    using box = sandbox(undefined, {
      cwd: { "package.json": "{}" },
      home: {
        [`.bun/install/cache/.bunx-${uid}`]: {
          "tool@latest": tree,
          "tool@latest.lock": "",
          "tool@latest+min-age=864000": tree,
          "tool@latest+trust": tree,
          // The packages of one scope count as one, as they always did.
          "@scope": { "a@latest": tree, "a@latest.lock": "", "b@1.0.0": tree },
        },
      },
      tmp: {
        [`.bunx-${uid}`]: { "tool@latest+min-age=5": tree, "tool@latest+min-age=5.lock": "" },
        // What older versions wrote.
        [`bunx-${uid}-tool@latest`]: tree,
        [`bunx-${uid + 1}-theirs@latest`]: tree,
      },
    });

    const result = await box.run(["cache", "rm"], { bunx: [bunExe(), "pm"] });
    expect(result.stdout).toContain("Cleared 6 cached 'bunx' packages");
    expect(result.exitCode).toBe(0);
    expect(existsSync(box.root)).toBe(false);
    expect(readdirSync(box.tmp)).toEqual([`bunx-${uid + 1}-theirs@latest`]);
  });
});

describe("a cached tree", () => {
  const ran = "tool 1.1.0 with dep 1.0.0\n";

  it.concurrent("a warm dist-tag run asks the registry and links nothing again", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    expect(await box.run(["tool@latest"])).toMatchObject({ stdout: ran, exitCode: 0 });

    const markers = plantMarkers(box.tree("tool@latest"), "tool", "dep");
    expect(await box.run(["tool@latest"])).toMatchObject({ stdout: ran, exitCode: 0, requests: ["/tool"] });
    expect(markers()).toEqual([true, true]);
  });

  it.concurrent("a dist-tag run follows the tag when it moves", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    for (const version of ["1.0.0", "1.1.0", "1.0.0"]) {
      registry.tagLatest("tool", version);
      expect(await box.run(["tool@latest"])).toMatchObject({
        stdout: `tool ${version} with dep 1.0.0\n`,
        exitCode: 0,
      });
    }
  });

  it.concurrent("a day-old tree is refreshed exactly once", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0, requests: [] });

    // The installed files are hard links into the install cache where the file system has them:
    // an install does not renew their age.
    age(box.tree("tool@latest"));

    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0, requests: ["/tool"] });
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0, requests: [] });
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0, requests: [] });
  });

  // An install without --force keeps every package whose package.json has the right name and version.
  describe.each(["tool", "tool@latest"])("bunx %s", spec => {
    it.concurrent("finishes an install that was killed", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0 });

      // bunx writes this before it installs, and `bun add` replaces it once everything is linked.
      writeFileSync(join(box.tree("tool@latest"), "package.json"), "{}\n");
      rmSync(join(box.tree("tool@latest"), "node_modules", "dep", "index.js"));

      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0 });
    });

    it.concurrent("repairs a damaged tree when it refreshes it", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0 });

      rmSync(join(box.tree("tool@latest"), "node_modules", "dep", "index.js"));
      age(box.tree("tool@latest"));

      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0 });
    });

    // On Windows the entry in .bin is a shim that exists on its own.
    it.concurrent.skipIf(isWindows)("links a tree again that lost the file of its bin", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0 });

      rmSync(join(box.tree("tool@latest"), "node_modules", "tool", "cli.js"));

      expect(await box.run([spec])).toMatchObject({ stdout: ran, exitCode: 0, requests: ["/tool"] });
    });
  });

  it.concurrent("--no-install uses a day-old tree, with a warning, and leaves it alone", async () => {
    // One bin is named after its package, the other is found through the installed package.json.
    using registry = await localRegistry(...toolWithDep(), ...uglifyJs());
    using box = sandbox(registry);
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(await box.run(["uglify-js"])).toMatchObject({ stdout: "uglifyjs 3.19.3\n", exitCode: 0 });
    age(box.tree("tool@latest"));
    age(box.tree("uglify-js@latest"));

    expect(await box.run(["--no-install", "tool"])).toMatchObject({
      stdout: ran,
      stderr: expect.stringContaining("warn: Using a stale installation of tool because --no-install was passed."),
      exitCode: 0,
      requests: [],
    });
    expect(await box.run(["--no-install", "uglify-js"])).toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("Could not find an existing 'uglify-js' binary to run."),
      exitCode: 1,
      requests: [],
    });
    expect(existsSync(join(box.tree("uglify-js@latest"), "node_modules", "uglify-js", "cli.js"))).toBe(true);
  });

  // With it, a tool that runs `bunx add` gets `bun add`, and its own `bun install` finds no workspace root.
  it.concurrent("the tool does not inherit the marker of the install bunx spawns", async () => {
    using registry = await localRegistry(
      fixturePackage(
        "env-probe",
        "1.0.0",
        "env-probe",
        `#!/usr/bin/env node\nconsole.log(String(process.env.BUN_INTERNAL_BUNX_INSTALL));\n`,
      ),
    );
    using box = sandbox(registry);
    expect(await box.run(["env-probe"])).toMatchObject({ stdout: "undefined\n", exitCode: 0 });
  });

  const outcomes = (results: { stdout: string; exitCode: number }[]) =>
    results.map(({ stdout, exitCode }) => ({ stdout, exitCode }));

  it.concurrent("concurrent dist-tag runs on a warm tree link nothing again", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    expect(await box.run(["tool@latest"])).toMatchObject({ stdout: ran, exitCode: 0 });

    const markers = plantMarkers(box.tree("tool@latest"), "tool", "dep");
    const results = await Promise.all(Array.from({ length: 8 }, () => box.run(["tool@latest"])));
    expect(outcomes(results)).toEqual(Array.from({ length: 8 }, () => ({ stdout: ran, exitCode: 0 })));
    expect(markers()).toEqual([true, true]);
  });

  it.concurrent("concurrent runs on a tree that just went stale refresh it once", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    age(box.tree("tool@latest"));

    const before = registry.requests.length;
    const results = await Promise.all(Array.from({ length: 4 }, () => box.run(["tool"])));
    expect(outcomes(results)).toEqual(Array.from({ length: 4 }, () => ({ stdout: ran, exitCode: 0 })));
    expect(registry.requests.slice(before)).toEqual(["/tool"]);
  });

  // The lock is beside the tree, in a directory for the scope that the first run has to create.
  it.concurrent("concurrent first-ever runs of a scoped package install it once", async () => {
    using registry = await localRegistry(fixturePackage("@bunx-fixture/cli", "1.2.3", "scoped-cli"));
    using box = sandbox(registry);

    const results = await Promise.all(Array.from({ length: 4 }, () => box.run(["@bunx-fixture/cli"])));
    expect(outcomes(results)).toEqual(Array.from({ length: 4 }, () => ({ stdout: "scoped-cli 1.2.3\n", exitCode: 0 })));
    expect(registry.requests).toEqual(["/@bunx-fixture%2fcli", "/@bunx-fixture/cli/-/cli-1.2.3.tgz"]);
  });

  describe("when the registry cannot be reached", () => {
    /** The URL of a registry that refuses every connection. */
    async function unreachable() {
      const registry = await localRegistry();
      registry[Symbol.dispose]();
      return registry.url;
    }

    it.concurrent("a day-old tree is used, with a warning, and left alone", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
      age(box.tree("tool@latest"));
      const markers = plantMarkers(box.tree("tool@latest"), "tool", "dep");

      const env = { ...box.env, npm_config_registry: await unreachable() };
      expect(await box.run(["tool"], { env })).toMatchObject({
        stdout: ran,
        stderr: expect.stringContaining(
          "warn: Could not reach the registry. Using the installation of tool that bunx has.",
        ),
        exitCode: 0,
      });
      expect(markers()).toEqual([true, true]);
      // It counts as a refresh: the next attempt is a day later.
      expect(await box.run(["tool"], { env })).toMatchObject({ stdout: ran, stderr: "", exitCode: 0 });
    });

    it.concurrent("an explicit dist-tag fails, and the tree stays as good as it was", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });

      const env = { ...box.env, npm_config_registry: await unreachable() };
      expect(await box.run(["tool@latest"], { env })).toMatchObject({ stdout: "", exitCode: 1 });
      expect(await box.run(["tool"], { env })).toMatchObject({ stdout: ran, stderr: "", exitCode: 0 });
    });

    it.concurrent("nothing is used that was never installed to the end", async () => {
      using registry = await localRegistry(...toolWithDep());
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
      writeFileSync(join(box.tree("tool@latest"), "package.json"), "{}\n");

      const env = { ...box.env, npm_config_registry: await unreachable() };
      expect(await box.run(["tool"], { env })).toMatchObject({ stdout: "", exitCode: 1 });
    });

    // The registry answered: what it took down is not run again.
    it.concurrent("a day-old tree is not used when the registry no longer has the package", async () => {
      using registry = await localRegistry(...toolWithDep());
      using without = await localRegistry();
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
      age(box.tree("tool@latest"));

      const env = { ...box.env, npm_config_registry: without.url };
      expect(await box.run(["tool"], { env })).toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("/tool - 404"),
        exitCode: 1,
      });
    });
  });

  // The linker skips an entry of `bin` whose value is not the path of a file in the package.
  it.concurrent("the bin of a package is the first entry of `bin` that is linked", async () => {
    using registry = await localRegistry({
      name: "many-bins",
      version: "1.0.0",
      bin: { "not-a-string": 1, "empty": "", "outside": "../../outside.js", "real": "cli.js" } as any,
      files: { "cli.js": echoBin("real 1.0.0") },
    });
    using box = sandbox(registry);
    expect(await box.run(["many-bins"])).toMatchObject({ stdout: "real 1.0.0\n", exitCode: 0 });
    expect(await box.run(["many-bins"])).toMatchObject({ stdout: "real 1.0.0\n", exitCode: 0, requests: [] });
  });

  // As on a file system without locks.
  it.concurrent.skipIf(isWindows)("runs without the lock when it cannot be taken", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    mkdirSync(box.tree("tool@latest") + ".lock", { recursive: true });
    chmodSync(box.root, 0o700);

    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, exitCode: 0 });
    expect(await box.run(["tool"])).toMatchObject({ stdout: ran, stderr: "", exitCode: 0, requests: [] });
  });
});

describe("flags", () => {
  // Skipping a flag made the value of `--flag value` the package that is downloaded and run.
  it.concurrent.each([
    [["--nope"]],
    [["--registry", "hello"]],
    [["--cwdx=sub"]],
    [["-c", "hello"]],
    [["--trust=true"]],
    [["-"]],
  ])("a flag bunx does not have is an error: %j", async flags => {
    using registry = await localRegistry(fixturePackage("hello", "1.0.0", "hello"), ...toolWithDep());
    using box = sandbox(registry);

    const expected = {
      stdout: "",
      stderr: `error: bunx has no ${flags[0]} flag. Flags for the package go after its name.\n`,
      exitCode: 1,
      requests: [],
    };
    expect(await box.run([...flags, "tool"])).toEqual(expected);
    if (flags.length === 1 && flags[0].startsWith("--")) {
      expect(await box.run(["x", "tool"], { bunx: [bunExe(), ...flags] })).toEqual(expected);
    }
  });

  it.concurrent("--yes, -y and -- are accepted", async () => {
    using box = sandbox();
    addLocalBin(box.cwd, "local-tool", `console.log("local", ...process.argv.slice(2));`);
    expect(await box.run(["--yes", "-y", "--", "local-tool", "--nope"])).toEqual({
      stdout: "local --nope\n",
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  // BUN_OPTIONS is for every command.
  it.concurrent.skipIf(isWindows)("what bunx does not know in BUN_OPTIONS is skipped, value included", async () => {
    using registry = await localRegistry();
    using box = sandbox(registry);
    addLocalBin(box.cwd, "local-tool", `console.log("local", ...process.argv.slice(2));`);
    symlinkSync(bunExe(), join(box.dir, "bunx"));

    const env = { ...box.env, BUN_OPTIONS: "--smol --preload ./preloaded.ts" };
    expect(await box.run(["local-tool", "--nope"], { env, bunx: [join(box.dir, "bunx")] })).toEqual({
      stdout: "local --nope\n",
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  it.concurrent.each(["--help", "-h"])("%s prints the flags", async flag => {
    using box = sandbox();
    const { stdout, stderr, exitCode } = await box.run([flag]);
    expect(stderr).toContain("Usage: bunx [flags] <package><@version>");
    for (const name of ["--cwd", "--env-file", "--minimum-release-age", "--trust"]) expect(stderr).toContain(name);
    // `--trust` is not scoped to the package that is named.
    expect(stderr).toContain("Run the lifecycle scripts of the package and of ALL of its dependencies");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
  });

  describe("--cwd", () => {
    const inSub = () => {
      const box = sandbox(undefined, { cwd: { sub: {} } });
      addLocalBin(
        join(box.cwd, "sub"),
        "hello",
        `console.log("hello from " + require("path").basename(process.cwd()));`,
      );
      return box;
    };

    it.concurrent.each([[["x", "--cwd", "sub"]], [["x", "--cwd=sub"]], [["--cwd=sub", "x"]]])(
      "bun %j hello runs in that directory",
      async flags => {
        using registry = await localRegistry();
        using box = inSub();
        const env = { ...box.env, npm_config_registry: registry.url };
        expect(await box.run([...flags, "hello"], { env, bunx: [bunExe()] })).toMatchObject({
          stdout: "hello from sub\n",
          stderr: "",
          exitCode: 0,
        });
        expect(registry.requests).toEqual([]);
      },
    );

    it.concurrent("a directory that does not exist is an error", async () => {
      using box = inSub();
      expect(await box.run(["--cwd", "missing", "hello"])).toMatchObject({
        stdout: "",
        stderr: expect.stringContaining(`Could not change directory to "missing"`),
        exitCode: 1,
      });
    });
  });

  // https://github.com/oven-sh/bun/issues/12430
  describe("--env-file", () => {
    const printsEnv = (files: Record<string, string>) => {
      const box = sandbox(undefined, { cwd: files });
      addLocalBin(
        box.cwd,
        "print-env",
        `console.log("A=" + (process.env.BUNX_TEST_A ?? "") + " B=" + (process.env.BUNX_TEST_B ?? ""), ...process.argv.slice(2));`,
      );
      return box;
    };

    it.concurrent.each([[["x", "--env-file", ".env.a"]], [["x", "--env-file=.env.a"]], [["--env-file=.env.a", "x"]]])(
      "bun %j loads the file for the command",
      async flags => {
        using box = printsEnv({ ".env.a": "BUNX_TEST_A=from-a\n" });
        expect(await box.run([...flags, "print-env"], { bunx: [bunExe()] })).toMatchObject({
          stdout: "A=from-a B=\n",
          stderr: "",
          exitCode: 0,
        });
      },
    );

    it.concurrent("the later of several files wins", async () => {
      using box = printsEnv({ ".env.a": "BUNX_TEST_A=1\nBUNX_TEST_B=from-a\n", ".env.b": "BUNX_TEST_B=from-b\n" });
      expect(await box.run(["--env-file", ".env.a", "--env-file=.env.b", "print-env"])).toMatchObject({
        stdout: "A=1 B=from-b\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it.concurrent("after the package name it belongs to the package", async () => {
      using box = printsEnv({ ".env.a": "BUNX_TEST_A=from-a\n" });
      expect(await box.run(["print-env", "--env-file", ".env.a"])).toMatchObject({
        stdout: "A= B= --env-file .env.a\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  it.concurrent.each([
    [["--cwd"], "--cwd"],
    [["--cwd=", "hello"], "--cwd"],
    [["--cwd", "", "hello"], "--cwd"],
    [["--env-file"], "--env-file"],
    // Also when nothing would run.
    [["--version", "--env-file"], "--env-file"],
    [["--minimum-release-age"], "--minimum-release-age"],
    [["--minimum-release-age=", "hello"], "--minimum-release-age"],
  ] as [args: string[], flag: string][])("%j: a flag that takes a value needs one", async (args, flag) => {
    using box = sandbox();
    expect(await box.run(args)).toEqual({
      stdout: "",
      stderr: `error: ${flag} requires a value\n`,
      exitCode: 1,
      requests: [],
    });
  });

  // https://github.com/oven-sh/bun/issues/30748
  describe("--minimum-release-age", () => {
    const tenDays = `${10 * 24 * 60 * 60}`;
    const oldAndNew = () =>
      localRegistry(
        { ...fixturePackage("tool", "1.0.0", "tool"), daysOld: 30 },
        { ...fixturePackage("tool", "2.0.0", "tool"), daysOld: 1 },
      );

    it.concurrent.each([
      [["x", `--minimum-release-age=${tenDays}`]],
      [["x", "--minimum-release-age", tenDays]],
      [[`--minimum-release-age=${tenDays}`, "x"]],
      [["x", "--minimum-release-age=10d"]],
      [["x", "--minimum-release-age", "2 weeks"]],
    ])("bun %j does not install a newer version", async flags => {
      using registry = await oldAndNew();
      using box = sandbox(registry);
      expect(await box.run([...flags, "tool"], { bunx: [bunExe()] })).toMatchObject({
        stdout: "tool 1.0.0\n",
        exitCode: 0,
        requests: ["/tool", "/tool/-/tool-1.0.0.tgz"],
      });
    });

    it.concurrent("fails when no version is old enough", async () => {
      using registry = await oldAndNew();
      using box = sandbox(registry);
      expect(await box.run(["--minimum-release-age=8640000000", "tool"])).toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("all versions blocked by minimum-release-age"),
        exitCode: 1,
      });
    });

    it.concurrent("runs with and without it do not serve each other's tree", async () => {
      using registry = await oldAndNew();
      using box = sandbox(registry);
      const gate = `--minimum-release-age=${tenDays}`;
      expect(await box.run(["tool"])).toMatchObject({ stdout: "tool 2.0.0\n", exitCode: 0 });
      expect(await box.run([gate, "tool"])).toMatchObject({ stdout: "tool 1.0.0\n", exitCode: 0 });
      expect(await box.run(["tool"])).toMatchObject({ stdout: "tool 2.0.0\n", exitCode: 0, requests: [] });
      expect(await box.run([gate, "tool"])).toMatchObject({ stdout: "tool 1.0.0\n", exitCode: 0, requests: [] });
      expect(existsSync(box.tree(`tool@latest+min-age=${tenDays}`))).toBe(true);
    });

    // It becomes part of a directory name. `bun add` stops reading at the first byte that is not part of a number.
    it.concurrent.each(["abc", "-5", "-0.5", "1e999", "Infinity", "NaN", "5x", "5/../../../escaped", "5:6"])(
      "%s is not a number of seconds",
      async value => {
        using registry = await oldAndNew();
        using box = sandbox(registry);
        expect(await box.run([`--minimum-release-age=${value}`, "tool"])).toEqual({
          stdout: "",
          stderr: `error: Expected --minimum-release-age to be a positive number: ${value}\n`,
          exitCode: 1,
          requests: [],
        });
      },
    );
  });

  // https://github.com/oven-sh/bun/issues/23906
  describe("--trust", () => {
    const script = { scripts: { postinstall: "node postinstall.js" } };
    const postinstall = { "postinstall.js": `require("fs").writeFileSync("postinstall-ran", "");\n` };
    const withScripts = () =>
      localRegistry(
        { name: "dep", version: "1.0.0", ...script, files: { "index.js": "", ...postinstall } },
        {
          name: "tool",
          version: "1.0.0",
          bin: { tool: "cli.js" },
          dependencies: { dep: "1.0.0" },
          ...script,
          files: {
            ...postinstall,
            "cli.js": `#!/usr/bin/env node
const ran = dir => require("fs").existsSync(require("path").join(__dirname, dir, "postinstall-ran"));
console.log("scripts ran: tool " + ran(".") + ", dep " + ran("../dep"));
`,
          },
        },
      );

    it.concurrent("is not the default", async () => {
      using registry = await withScripts();
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: "scripts ran: tool false, dep false\n", exitCode: 0 });
    });

    // `bun add --trust` trusts the dependency closure, not only the package that is named.
    it.concurrent("runs the scripts of the package and of its dependencies, in a tree of its own", async () => {
      using registry = await withScripts();
      using box = sandbox(registry);
      expect(await box.run(["tool"])).toMatchObject({ stdout: "scripts ran: tool false, dep false\n", exitCode: 0 });
      expect(await box.run(["--trust", "tool"])).toMatchObject({
        stdout: "scripts ran: tool true, dep true\n",
        exitCode: 0,
      });
      expect(await box.run(["tool"])).toMatchObject({
        stdout: "scripts ran: tool false, dep false\n",
        exitCode: 0,
        requests: [],
      });
      expect(await box.run(["--trust", "tool"])).toMatchObject({
        stdout: "scripts ran: tool true, dep true\n",
        exitCode: 0,
        requests: [],
      });
    });
  });

  it.concurrent("--env-file, --minimum-release-age and --cwd together", async () => {
    using registry = await localRegistry(
      {
        ...fixturePackage(
          "tool",
          "1.0.0",
          "tool",
          `#!/usr/bin/env node\nconsole.log("tool 1.0.0", process.env.BUNX_TEST_A, require("path").basename(process.cwd()));\n`,
        ),
        daysOld: 30,
      },
      { ...fixturePackage("tool", "2.0.0", "tool"), daysOld: 1 },
    );
    // The file is looked up in the directory --cwd names, as with `bun run`.
    using box = sandbox(registry, { cwd: { sub: { ".env.a": "BUNX_TEST_A=from-a\n" } } });
    expect(
      await box.run(["--env-file", ".env.a", "--minimum-release-age=864000", "--cwd", "sub", "tool"]),
    ).toMatchObject({ stdout: "tool 1.0.0 from-a sub\n", exitCode: 0 });
  });

  // The arguments of the install used to go into an array of eight.
  it.concurrent("every flag that reaches the install at once", async () => {
    using registry = await localRegistry(...toolWithDep());
    using box = sandbox(registry);
    const flags = ["--verbose", "--silent", "--trust", "--minimum-release-age=0"];
    const ran = "tool 1.1.0 with dep 1.0.0\n";
    expect((await box.run([...flags, "tool@latest"])).stdout).toEndWith(ran);
    // --no-cache and --force as well.
    age(box.tree("tool@latest+trust+min-age=0"));
    const refreshed = await box.run([...flags, "tool@latest"]);
    expect(refreshed.stdout).toEndWith(ran);
    expect(refreshed.exitCode).toBe(0);
  });
});

// bunx formats the paths it probes into a path buffer (4096 bytes on Linux, 1024
// on macOS). What goes into them is not bounded: the bin name comes out of a
// package.json and the cache directory out of the environment.
describe("paths that do not fit in the path buffer", () => {
  // Longer than the path buffer of every platform (~96 KiB on Windows).
  const longBinName = Buffer.alloc(100_000, "x").toString();
  const packageJson = JSON.stringify({ name: "long-bin", version: "1.0.0", bin: { [longBinName]: "cli.js" } });

  it.concurrent("bin name from the project's node_modules", async () => {
    using box = sandbox(undefined, { cwd: { node_modules: { "long-bin": { "package.json": packageJson } } } });
    expect(await box.run(["--no-install", "long-bin"])).toMatchObject({
      stdout: "",
      stderr: expect.stringMatching(/PathTooLong|Could not find an existing 'long-bin' binary to run\./),
      exitCode: 1,
    });
  });

  it.concurrent("bin name from the package bunx installed", async () => {
    // Only the tarball declares the bin: if the manifest did, `bun add` would fail to link it.
    using registry = await localRegistry({
      name: "long-bin",
      version: "1.0.0",
      files: { "package.json": packageJson, "cli.js": echoBin("ran") },
    });
    using box = sandbox(registry);
    expect(await box.run(["long-bin"])).toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("PathTooLong"),
      exitCode: 1,
      requests: ["/long-bin", "/long-bin/-/long-bin-1.0.0.tgz"],
    });
  });

  // The install cache is so deep that <tree>/node_modules/<package>/package.json, which bunx reads for the
  // name of the bin, ends right at the size of the buffer, while <tree>/node_modules/.bin/<bin> always fits.
  // One byte under, it fits together with its NUL. On Windows no existing directory overflows the buffer.
  it.concurrent.skipIf(isWindows).each([
    ["one byte under the size of the path buffer", -1],
    ["exactly the size of the path buffer", 0],
    ["64 bytes over the size of the path buffer", 64],
  ] as const)("the package.json in the tree is %s", async (_label, overBy) => {
    const maxPathBytes = isLinux ? 4096 : 1024;
    using box = sandbox();
    const name = "deep-cache-fixture";
    const pkg = `@${Buffer.alloc(100, "s").toString()}/${name}`;
    const bin = "deep-cache-bin";
    const treeInCache = `.bunx-${process.getuid!()}/${pkg}@latest`;

    const cacheLength = maxPathBytes + overBy - `/${treeInCache}/node_modules/${pkg}/package.json`.length;
    let cache = box.home;
    while (cache.length < cacheLength) {
      let component = Math.min(200, cacheLength - cache.length - 1);
      // Never leave exactly one byte, which would need an empty component.
      if (cacheLength - cache.length - 1 - component === 1) component--;
      cache += "/" + Buffer.alloc(component, "p").toString();
    }
    expect(cache).toHaveLength(cacheLength);
    const tree = join(cache, treeInCache);
    expect(bin.length).toBeLessThanOrEqual(name.length);
    expect(`${tree}/node_modules/.bin/${name}`.length).toBeLessThan(maxPathBytes);

    mkdirSync(join(tree, "node_modules", ".bin"), { recursive: true });
    chmodSync(join(cache, `.bunx-${process.getuid!()}`), 0o700);
    writeFileSync(join(tree, "package.json"), JSON.stringify({ dependencies: { [pkg]: "^1.0.0" } }));
    // The bin is always there: whether bunx finds out about it depends on whether the path fits.
    writeFileSync(join(tree, "node_modules", ".bin", bin), "#!/bin/sh\necho ran the bin\n");
    chmodSync(join(tree, "node_modules", ".bin", bin), 0o755);
    if (overBy < 0) {
      mkdirSync(join(tree, "node_modules", pkg), { recursive: true });
      writeFileSync(
        join(tree, "node_modules", pkg, "package.json"),
        JSON.stringify({ name: pkg, version: "1.0.0", bin: { [bin]: "cli.js" } }),
      );
    }

    const result = await box.run(["--no-install", pkg], { env: { ...box.env, BUN_INSTALL_CACHE_DIR: cache } });
    if (overBy < 0) {
      expect(result).toMatchObject({ stdout: "ran the bin\n", stderr: "", exitCode: 0 });
    } else {
      expect(result).toMatchObject({
        stdout: "",
        stderr: expect.stringContaining(`Could not find an existing '${name}' binary to run.`),
        exitCode: 1,
      });
    }
  });
});
