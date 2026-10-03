import { spawn } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, readdirSorted, tmpdirSync } from "harness";
import { chmodSync, copyFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "os";
import { delimiter, join, resolve } from "path";
import { dummyAfterAll, dummyBeforeAll, dummyBeforeEach, dummyRegistry, getPort, setHandler } from "./dummy.registry";

setDefaultTimeout(1000 * 60 * 5);

let x_dir: string;
let env: Record<string, string> = { ...bunEnv };

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

/**
 * A .tgz with every entry under `root/`: `package/` for npm tarballs,
 * `<owner>-<repo>-<commit>/` for GitHub's. The directory entry comes first
 * because bun install reads a GitHub tarball's first entry as that root.
 */
function tarball(root: string, files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
  const entries: Record<string, string> = { [`${root}/`]: "" };
  for (const [path, contents] of Object.entries(files)) entries[`${root}/${path}`] = contents;
  return new Bun.Archive(entries, { compress: "gzip" }).bytes();
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
    { name: string; versions: Record<string, object>; "dist-tags": { latest: string } }
  >();
  const tarballs = new Map<string, Uint8Array<ArrayBuffer>>();
  const registry = fixtureServer(
    pathname => tarballs.get(pathname) ?? manifests.get(decodeURIComponent(pathname.slice(1))),
  );
  for (const { name, version, bin, dependencies, scripts, files } of packages) {
    const tarballPath = `/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`;
    const packageJson = { name, version, bin, dependencies, scripts };
    tarballs.set(tarballPath, await tarball("package", { "package.json": JSON.stringify(packageJson), ...files }));
    const manifest = manifests.get(name) ?? { name, versions: {}, "dist-tags": { latest: version } };
    manifest.versions[version] = { ...packageJson, dist: { tarball: `${registry.url}${tarballPath}` } };
    manifest["dist-tags"].latest = version;
    manifests.set(name, manifest);
  }
  return registry;
}

/**
 * Stands in for api.github.com (bun install honors `GITHUB_API_URL`): every
 * `/repos/<owner>/<repo>/tarball/<ref>` request gets the one fixture repository.
 */
async function localGithub(owner: string, repo: string, files: Record<string, string>) {
  const bytes = await tarball(`${owner}-${repo}-0123abc`, files);
  return fixtureServer(pathname => (pathname.startsWith(`/repos/${owner}/${repo}/tarball/`) ? bytes : undefined));
}

beforeAll(async () => {
  // Clean stale bunx cache dirs from previous runs once up front instead of before every test.
  const tmp = isWindows ? tmpdir() : "/tmp";
  const waiting: Promise<void>[] = [];
  readdirSync(tmp).forEach(file => {
    if (file.startsWith("bunx-") || file.startsWith("bun-x.test")) {
      waiting.push(rm(join(tmp, file), { recursive: true, force: true }));
    }
  });
  await Promise.all(waiting);
});

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
  const decoyBinDir = tmpdirSync();
  if (isWindows) {
    await writeFile(join(decoyBinDir, "semver.cmd"), "@echo semver from PATH\r\n");
  } else {
    await writeFile(join(decoyBinDir, "semver"), '#!/bin/sh\necho "semver from PATH"\n');
    chmodSync(join(decoyBinDir, "semver"), 0o755);
  }

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

// The bunx cache root lives at a predictable path inside the shared temp dir
// ($TMPDIR/bunx-<uid>-<pkg>@<version>). bunx must refuse to reuse a
// pre-existing cache root that is not a private directory owned by the
// current user, because the owner of that directory can replace any of the
// cached package's module files after install. The check happens before any
// network or filesystem access inside the cache, so this test is fully
// offline. The check is Unix-only (no uid/world-writable-tmp model on
// Windows).
it.concurrent.skipIf(isWindows)(
  "refuses to reuse a bunx cache directory that other local users can modify",
  async () => {
    const { x_dir, env } = setup();
    const pkg = "bunx-cache-root-fixture";
    const cacheRoot = join(env.TMPDIR, `bunx-${process.getuid!()}-${pkg}@latest`);

    const run = () => {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", pkg],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
    };

    // Legitimate case: a pre-existing cache root that is a private directory
    // owned by the current user is accepted. bunx gets past the cache-root
    // validation and fails later with the normal --no-install "could not
    // find an existing binary" message because the cache is empty.
    await mkdir(cacheRoot, { recursive: true });
    chmodSync(cacheRoot, 0o755);
    {
      const [err, out, exitCode] = await run();
      expect(err).not.toContain("refusing to use bunx cache directory");
      expect(err).toContain(`Could not find an existing '${pkg}' binary to run.`);
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    // The same cache root made writable by group/other -- the state a
    // pre-created directory in the shared temp dir must be in for another
    // user's install to populate it -- must be refused before bunx reads or
    // writes anything inside it.
    chmodSync(cacheRoot, 0o777);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    // A cache root that is a symlink (redirecting the whole install
    // elsewhere) must also be refused.
    await rm(cacheRoot, { recursive: true, force: true });
    const elsewhere = join(env.TMPDIR, "bunx-cache-root-fixture-elsewhere");
    await mkdir(elsewhere, { recursive: true });
    symlinkSync(elsewhere, cacheRoot);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }
  },
);

it.concurrent.skipIf(isWindows)(
  "validates every path component of a scoped package's bunx cache directory",
  async () => {
    const { x_dir, env } = setup();
    const scope = "bunx-cache-scope-fixture";
    const pkg = "bunx-cache-root-fixture";
    const scopeDir = join(env.TMPDIR, `bunx-${process.getuid!()}-@${scope}`);

    const run = () => {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", `@${scope}/${pkg}`],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
    };

    await mkdir(scopeDir, { recursive: true });
    chmodSync(scopeDir, 0o755);
    {
      const [err, out, exitCode] = await run();
      expect(err).not.toContain("refusing to use bunx cache directory");
      expect(err).toContain(`Could not find an existing '${pkg}' binary to run.`);
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    chmodSync(scopeDir, 0o777);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    await rm(scopeDir, { recursive: true, force: true });
    const elsewhere = join(env.TMPDIR, "bunx-cache-scope-fixture-elsewhere");
    await mkdir(elsewhere, { recursive: true });
    chmodSync(elsewhere, 0o755);
    symlinkSync(elsewhere, scopeDir);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }
  },
);
