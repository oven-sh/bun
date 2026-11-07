import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
} from "fs";
import { appendFile, exists, mkdir, rm, symlink, writeFile } from "fs/promises";
import {
  assertManifestsPopulated,
  bunEnv as baseEnv,
  bunExe,
  githubTarball,
  isLinux,
  isWindows,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  tempDir,
} from "harness";
import { constants as osConstants, type as osType, tmpdir } from "os";
import { join, sep } from "path";
import { TestRegistry } from "registry";
import { pathToFileURL } from "url";

var verdaccio = new TestRegistry();

// `owner/repo#commit` dependencies are downloaded from `${GITHUB_API_URL}/repos/...`, so
// the repository below is served by this local server instead of api.github.com.
const githubOwner = "lifecycle-owner";
const githubRepo = "lifecycle-install-test";
const githubCommit = "1234567890abcdef1234567890abcdef12345678";
const githubDependency = `${githubOwner}/${githubRepo}#${githubCommit}`;
const githubTarballPath = `/repos/${githubOwner}/${githubRepo}/tarball/${githubCommit}`;
const githubLifecycleScripts = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"];
const githubRepositoryTarball = await githubTarball(`${githubOwner}-${githubRepo}-${githubCommit.slice(0, 7)}`, {
  "package.json": JSON.stringify({
    name: githubRepo,
    version: "1.0.0",
    scripts: Object.fromEntries(githubLifecycleScripts.map(script => [script, `bun ${script}.js`])),
  }),
  ...Object.fromEntries(
    githubLifecycleScripts.map(script => [
      `${script}.js`,
      `
      import { writeFileSync } from "fs";
      import { join } from "path";

      writeFileSync(join(import.meta.dir, "${script}.txt"), "${script}!");
      `,
    ]),
  ),
});
let github: ReturnType<typeof Bun.serve>;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  github = Bun.serve({
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === githubTarballPath
        ? new Response(githubRepositoryTarball)
        : new Response("Not Found", { status: 404 });
    },
  });
  await verdaccio.start();
});

afterAll(async () => {
  verdaccio.stop();
  await github.stop();
});

function splitErrLines(err: string): string[] {
  return err.split(/\r?\n/).filter(s => !s.startsWith("WARNING: ASAN interferes"));
}

// Tests in this file each spawn `bun install` which itself spawns multiple lifecycle
// script subprocesses. Running them all concurrently would fork-bomb the machine, so
// gate concurrency with a small semaphore and give each test its own isolated dir/env.
const MAX_CONCURRENT = 12;
let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENT) {
    activeSlots++;
    return Promise.resolve();
  }
  return new Promise(resolve => slotWaiters.push(resolve));
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    next();
  } else {
    activeSlots--;
  }
}

type TestCtx = {
  packageDir: string;
  packageJson: string;
  env: Record<string, string>;
  [Symbol.dispose](): void;
};

async function setupTest(): Promise<TestCtx> {
  await acquireSlot();
  let released = false;
  try {
    const { packageDir, packageJson } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    const env: Record<string, string> = {
      ...baseEnv,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
      BUN_TMPDIR: join(packageDir, ".bun-tmp"),
      TMPDIR: join(packageDir, ".bun-tmp"),
      TEMP: join(packageDir, ".bun-tmp"),
    };
    return {
      packageDir,
      packageJson,
      env,
      [Symbol.dispose]() {
        if (!released) {
          released = true;
          releaseSlot();
        }
      },
    };
  } catch (e) {
    releaseSlot();
    released = true;
    throw e;
  }
}

// The six multi-install tests below are the longest in the file (2-3 serial `bun install`s
// each, some with cold caches). Declare them first so they start before the ~110 shorter
// tests and overlap with them instead of forming a serial tail at the end of the run.
test.concurrent("ignore-scripts is read from npmrc", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.2.3",
        dependencies: {
          "uses-what-bin": "1.0.0",
        },
        scripts: {
          postinstall: `${bunExe()} -e 'await Bun.write("postinstall.txt", "postinstall!!")'`,
        },
        trustedDependencies: ["uses-what-bin"],
      }),
    ),
    write(join(packageDir, ".npmrc"), "ignore-scripts=true"),
  ]);

  async function checkScripts(): Promise<boolean[]> {
    return Promise.all([
      exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")),
      exists(join(packageDir, "postinstall.txt")),
    ]);
  }

  await runBunInstall(env, packageDir);
  expect(await checkScripts()).toEqual([false, false]);

  await write(join(packageDir, ".npmrc"), "ignore-scripts=false");

  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(await checkScripts()).toEqual([false, true]);

  await Promise.all([
    rm(join(packageDir, "postinstall.txt")),
    rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
  ]);
  expect(await checkScripts()).toEqual([false, false]);

  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(await checkScripts()).toEqual([true, true]);
});

test.concurrent("trustedDependencies matches the resolved package name, not the dependency alias", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;

  // A dependent controls the aliases of its own dependencies, so an entry like
  // `"esbuild": "npm:uses-what-bin@1.0.0"` must not inherit lifecycle-script
  // trust from `trustedDependencies: ["esbuild"]`. Trust is keyed on the
  // resolved package name, never the alias.
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "esbuild": "npm:uses-what-bin@1.0.0",
      },
      trustedDependencies: ["esbuild"],
    }),
  );

  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  let err = await stderr.text();
  let out = await stdout.text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(out).toContain("Blocked 1 postinstall");
  expect(await exists(join(packageDir, "node_modules", "esbuild", "package.json"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "esbuild", "what-bin.txt"))).toBeFalse();
  expect(await exited).toBe(0);

  // Trusting the *resolved* package name still grants trust to the same
  // aliased dependency.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lock"), { force: true });
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "esbuild": "npm:uses-what-bin@1.0.0",
      },
      trustedDependencies: ["uses-what-bin"],
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).not.toContain("Blocked");
  expect(await exists(join(packageDir, "node_modules", "esbuild", "what-bin.txt"))).toBeTrue();
  expect(await exited).toBe(0);
});

test.concurrent(
  "trustedDependencies added on a later install still matches the resolved package name, not the dependency alias",
  async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;

    const dependencies = { "esbuild": "npm:uses-what-bin@1.0.0" };
    await writeFile(packageJson, JSON.stringify({ name: "foo", version: "1.0.0", dependencies }));

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    let err = await stderr.text();
    let out = await stdout.text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(out).toContain("Blocked 1 postinstall");
    expect(await exists(join(packageDir, "node_modules", "esbuild", "package.json"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "esbuild", "what-bin.txt"))).toBeFalse();
    expect(await exited).toBe(0);

    await writeFile(
      packageJson,
      JSON.stringify({ name: "foo", version: "1.0.0", dependencies, trustedDependencies: ["esbuild"] }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    }));

    err = await stderr.text();
    out = await stdout.text();
    expect(err).not.toContain("error:");
    expect(await exists(join(packageDir, "node_modules", "esbuild", "what-bin.txt"))).toBeFalse();
    expect(await exited).toBe(0);
  },
);

// The value of such a rule is read under the alias. What it installs is still trusted by its own name.
describe.concurrent.each(["npm:uses-what-bin@1.0.0", "catalog:"])(
  "an override keyed by an npm: alias, with the value %s",
  value => {
    test.each([
      {
        title: "the alias in trustedDependencies doesn't run its scripts",
        trustedDependencies: ["esbuild"],
        runs: false,
      },
      { title: "the alias in the default list doesn't run its scripts", trustedDependencies: undefined, runs: false },
      { title: "its own name in trustedDependencies does", trustedDependencies: ["uses-what-bin"], runs: true },
    ])("$title", async ({ trustedDependencies, runs }) => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: { packages: [], catalog: { "esbuild": "npm:uses-what-bin@1.0.0", "uses-what-bin": "1.0.0" } },
          dependencies: { "esbuild": "npm:uses-what-bin@^1.0.0" },
          overrides: { "esbuild@npm:uses-what-bin@^1.0.0": value },
          trustedDependencies,
        }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("error:");
      // Without the rule it is 1.5.0.
      const { name, version } = await file(join(packageDir, "node_modules", "esbuild", "package.json")).json();
      expect({ name, version }).toEqual({ name: "uses-what-bin", version: "1.0.0" });
      expect(await exists(join(packageDir, "node_modules", "esbuild", "what-bin.txt"))).toBe(runs);
      expect(out.includes("Blocked 1 postinstall")).toBe(!runs);
      expect(exitCode).toBe(0);
    });
  },
);

describe("trustedDependencies survive lockfile migration", () => {
  // `electron` is on the default trusted list, `uses-what-bin` is not. Declaring
  // `trustedDependencies: ["uses-what-bin"]` therefore has to flip both: the
  // migrated lockfile must run uses-what-bin's install script and block electron's.
  const integrity = {
    "electron": "sha512-GkuwCdn6o8Krsxb3DIIqYP+TAi8Y5jYUadmseZ6nR2op2k5ssdKRYo4JjYDGopa1ACrGAcQuWViz/+vX/WjYnA==",
    "uses-what-bin": "sha512-EI+uMDESinRewWTFhsyzibkzFV+j5LmLM7T1jEpb2X82TmzhSQRzCBTBURflt5dGvNEIY7l563P9Su01Tpe++g==",
    "what-bin": "sha512-mbvEObM9mSliIzNJ4lJHfx8Zzdcf3v8PCIanJyIbXv6AFuuipK5tirQuM9Oi1yFXgO/YxI1W5zt4AwwLGxmaPA==",
  };
  const shasum = {
    "electron": "f1b8bc2c23cd7e4f1500669dfaf8757578d2e391",
    "uses-what-bin": "78dea365c24435c0faa99dca78ed44c42273b84a",
    "what-bin": "934dc0859a1a9ccf90ac341b1d4867f94d8e4d11",
  };
  const dependencies = { "electron": "1.0.0", "uses-what-bin": "1.5.0" };

  function tarball(name: keyof typeof integrity, version: string) {
    return `http://localhost:${verdaccio.port}/${name}/-/${name}-${version}.tgz`;
  }

  function packageLock() {
    return JSON.stringify({
      name: "foo",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "foo", version: "1.0.0", dependencies },
        "node_modules/electron": {
          version: "1.0.0",
          resolved: tarball("electron", "1.0.0"),
          integrity: integrity["electron"],
          hasInstallScript: true,
        },
        "node_modules/uses-what-bin": {
          version: "1.5.0",
          resolved: tarball("uses-what-bin", "1.5.0"),
          integrity: integrity["uses-what-bin"],
          hasInstallScript: true,
          dependencies: { "what-bin": "1.5.0" },
        },
        "node_modules/what-bin": {
          version: "1.5.0",
          resolved: tarball("what-bin", "1.5.0"),
          integrity: integrity["what-bin"],
          bin: { "what-bin": "what-bin.js" },
        },
      },
    });
  }

  function yarnLock() {
    return `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


electron@1.0.0:
  version "1.0.0"
  resolved "${tarball("electron", "1.0.0")}#${shasum["electron"]}"
  integrity ${integrity["electron"]}

uses-what-bin@1.5.0:
  version "1.5.0"
  resolved "${tarball("uses-what-bin", "1.5.0")}#${shasum["uses-what-bin"]}"
  integrity ${integrity["uses-what-bin"]}
  dependencies:
    what-bin "1.5.0"

what-bin@1.5.0:
  version "1.5.0"
  resolved "${tarball("what-bin", "1.5.0")}#${shasum["what-bin"]}"
  integrity ${integrity["what-bin"]}
`;
  }

  function pnpmLock(importer: string) {
    return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
${importer}
packages:

  electron@1.0.0:
    resolution: {integrity: ${integrity["electron"]}}

  uses-what-bin@1.5.0:
    resolution: {integrity: ${integrity["uses-what-bin"]}}

  what-bin@1.5.0:
    resolution: {integrity: ${integrity["what-bin"]}}
    hasBin: true

snapshots:

  electron@1.0.0: {}

  uses-what-bin@1.5.0:
    dependencies:
      what-bin: 1.5.0

  what-bin@1.5.0: {}
`;
  }

  const importerDependencies = `
    dependencies:
      electron:
        specifier: 1.0.0
        version: 1.0.0
      uses-what-bin:
        specifier: 1.5.0
        version: 1.5.0
`;

  async function runBunPm(env: Record<string, string>, packageDir: string, subcommand: string) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", subcommand],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    return { out, err };
  }

  // The migrated bun.lock is what gets committed and installed from with
  // --frozen-lockfile, which never writes it back, so everything package.json
  // declares has to be in it when `bun pm migrate` returns.
  async function expectMigrationKeepsTrust(env: Record<string, string>, packageDir: string, lockfileName: string) {
    const { err: migrateErr } = await runBunPm(env, packageDir, "migrate");
    expect(migrateErr).toContain(`migrated lockfile from ${lockfileName}`);
    expect(await file(join(packageDir, "bun.lock")).text()).toMatch(
      /"trustedDependencies": \[\s*"uses-what-bin",\s*\]/,
    );

    await runBunInstall(env, packageDir, { frozenLockfile: true });
    expect(
      await Promise.all([
        exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")),
        exists(join(packageDir, "node_modules", "electron", "preinstall.txt")),
      ]),
    ).toEqual([true, false]);

    const { out } = await runBunPm(env, packageDir, "untrusted");
    expect(out).toContain("./node_modules/electron @1.0.0".replaceAll("/", sep));
    expect(out).not.toContain("uses-what-bin");
  }

  const rootLockfiles: Record<string, () => string> = {
    "package-lock.json": packageLock,
    "yarn.lock": yarnLock,
    "pnpm-lock.yaml": () => pnpmLock(`\n  .:${importerDependencies}`),
  };

  for (const [lockfileName, contents] of Object.entries(rootLockfiles)) {
    test.concurrent(`bun pm migrate from ${lockfileName} keeps the root's trustedDependencies`, async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;

      await Promise.all([
        write(
          packageJson,
          JSON.stringify({ name: "foo", version: "1.0.0", dependencies, trustedDependencies: ["uses-what-bin"] }),
        ),
        write(join(packageDir, lockfileName), contents()),
      ]);

      await expectMigrationKeepsTrust(env, packageDir, lockfileName);
    });
  }

  test.concurrent("bun pm migrate from pnpm-lock.yaml keeps a workspace member's trustedDependencies", async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;

    // Like `bun install`, a list declared by a member counts for the whole
    // install: it is recorded and it turns the default trusted list off.
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "foo", version: "1.0.0", workspaces: ["packages/*"] })),
      write(join(packageDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n"),
      write(
        join(packageDir, "packages", "app", "package.json"),
        JSON.stringify({ name: "app", version: "1.0.0", dependencies, trustedDependencies: ["uses-what-bin"] }),
      ),
      write(join(packageDir, "pnpm-lock.yaml"), pnpmLock(`\n  .: {}\n\n  packages/app:${importerDependencies}`)),
    ]);

    await expectMigrationKeepsTrust(env, packageDir, "pnpm-lock.yaml");
  });
});

test.concurrent("node-gyp shim directory added to lifecycle script PATH gets a randomized name", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;

  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "no-deps": "1.0.0",
      },
      scripts: {
        postinstall: `${bunExe()} -e 'await Bun.write("path.txt", String(process.env.PATH))'`,
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  const pathVar = await file(join(packageDir, "path.txt")).text();
  const match = pathVar.match(/\.([0-9a-f]{1,16})-[0-9A-F]{1,16}\.node-gyp/);
  expect(match).not.toBeNull();
  const derived = BigInt("0x" + match![1]) ^ 12345n;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const distance = derived > nowNs ? derived - nowNs : nowNs - derived;
  expect(distance > 21_600_000_000_000n).toBe(true);
});

// Reproducing issue #38079 needs $TMPDIR and the install cache on different
// filesystems so that renameat() fails with EXDEV. /dev/shm is a separate
// tmpfs mount on Linux; skip when it is unavailable or on the same device.
const canForceExdevTmpdir =
  isLinux &&
  (() => {
    try {
      return statSync("/dev/shm").dev !== statSync(tmpdir()).dev;
    } catch {
      return false;
    }
  })();

test.concurrent.skipIf(!canForceExdevTmpdir)(
  "node-gyp shim is reachable when the tempdir falls back to cache/.tmp",
  async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;

    const fakeNodeGyp = join(packageDir, "fake-node-gyp.sh");
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "exdev-node-gyp",
          version: "1.0.0",
          scripts: {
            preinstall: "node-gyp --version",
          },
        }),
      ),
      write(fakeNodeGyp, "#!/bin/sh\necho fake-node-gyp-ok\n"),
    ]);
    chmodSync(fakeNodeGyp, 0o755);

    const shmTmp = mkdtempSync("/dev/shm/bun-exdev-");
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: {
          ...env,
          TMPDIR: shmTmp,
          BUN_TMPDIR: shmTmp,
          TEMP: shmTmp,
          // Keep `node-gyp` resolvable only through the shim directory that Bun appends to PATH. The shim runs
          // $npm_config_node_gyp, so the test stays offline.
          PATH: "/usr/bin:/bin",
          npm_config_node_gyp: fakeNodeGyp,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("command not found");
      expect(out).toContain("fake-node-gyp-ok");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(shmTmp, { recursive: true, force: true });
    }
  },
);

// The environment `bun install` built is all a lifecycle script gets. On
// Windows (and on POSIX without a shell) the script runs through `bun exec`,
// which used to load the .env* files of the script's own directory on top of
// that, so a workspace package's .env reached its scripts there and nowhere else.
test.concurrent("lifecycle scripts do not get the .env files of the package directory", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;
  const pkgDir = join(packageDir, "packages", "pkg1");

  await mkdir(pkgDir, { recursive: true });
  await Promise.all([
    writeFile(packageJson, JSON.stringify({ name: "foo", version: "1.0.0", workspaces: ["packages/*"] })),
    writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        scripts: { postinstall: "echo PKG_DOTENV=$PKG_DOTENV INHERITED=$LIFECYCLE_INHERITED > seen.txt" },
      }),
    ),
    writeFile(join(pkgDir, ".env"), "PKG_DOTENV=leaked"),
  ]);

  await runBunInstall({ ...env, PKG_DOTENV: undefined, LIFECYCLE_INHERITED: "from-install" }, packageDir);

  expect((await file(join(pkgDir, "seen.txt")).text()).trim()).toBe("PKG_DOTENV= INHERITED=from-install");
});

test.concurrent("default trusted dependencies require the canonical registry tarball URL", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;

  // No `trustedDependencies` in package.json: `electron` is on the default
  // trusted list, so the genuine registry package's lifecycle scripts run.
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "electron": "1.0.0",
      },
    }),
  );

  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  let err = await stderr.text();
  let out = await stdout.text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(out).not.toContain("Blocked");
  expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
  expect(await exited).toBe(0);

  // Tamper with the lockfile: keep the default-trusted name `electron` but
  // point its tarball URL at a different package on the same registry. The
  // install must still succeed, but the package must no longer inherit the
  // default lifecycle-script grant because the URL is not the canonical
  // registry tarball for `electron@1.0.0`.
  const lockfilePath = join(packageDir, "bun.lock");
  const lockfile = await file(lockfilePath).text();
  expect(lockfile).toContain("/electron/-/electron-1.0.0.tgz");
  await writeFile(
    lockfilePath,
    lockfile
      .replace("/electron/-/electron-1.0.0.tgz", "/all-lifecycle-scripts/-/all-lifecycle-scripts-1.0.0.tgz")
      .replace(/"sha512-[^"]+"/, '""'),
  );

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  // The redirected tarball (all-lifecycle-scripts content) installs under the
  // recorded name, but its preinstall/install/postinstall must not run: the
  // package no longer inherits default trust from the `electron` name because
  // the URL is not the canonical registry tarball for `electron@1.0.0`.
  expect(await exists(join(packageDir, "node_modules", "electron", "package.json"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "electron", "install.js"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
  expect(await exists(join(packageDir, "node_modules", "electron", "install.txt"))).toBeFalse();
  expect(await exists(join(packageDir, "node_modules", "electron", "postinstall.txt"))).toBeFalse();
  expect(await exited).toBe(0);

  // Tamper again: keep the canonical path for `electron@1.0.0` but point the
  // URL at a different origin — a second local server that proxies to the
  // real registry. The tarball still downloads and the integrity still
  // matches, but the origin is not the configured registry, so the default
  // lifecycle-script grant must not apply.
  using proxy = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      return fetch(`http://localhost:${verdaccio.port}${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
      });
    },
  });
  const canonicalUrl = `http://localhost:${verdaccio.port}/electron/-/electron-1.0.0.tgz`;
  expect(lockfile).toContain(canonicalUrl);
  await writeFile(
    lockfilePath,
    lockfile.replace(canonicalUrl, `http://localhost:${proxy.port}/electron/-/electron-1.0.0.tgz`),
  );

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(await exists(join(packageDir, "node_modules", "electron", "package.json"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
  expect(await exists(join(packageDir, "node_modules", "electron", "install.txt"))).toBeFalse();
  expect(await exists(join(packageDir, "node_modules", "electron", "postinstall.txt"))).toBeFalse();
  expect(await exited).toBe(0);
});

describe("default trusted dependencies after yarn.lock migration", () => {
  const electronIntegrity =
    "sha512-GkuwCdn6o8Krsxb3DIIqYP+TAi8Y5jYUadmseZ6nR2op2k5ssdKRYo4JjYDGopa1ACrGAcQuWViz/+vX/WjYnA==";
  // `all-lifecycle-scripts@1.0.0`: a different package with preinstall, install
  // and postinstall scripts of its own, used to record a tarball that is not
  // electron's under the default-trusted name `electron`.
  const otherIntegrity =
    "sha512-hgU56juWYnFOQ3byQuydEgugxd+iWvaWfaoGvly4k/AxehC3dhM6IhXoDc3K7b/n1mP/II8hGIjI+LmxXFNMlw==";

  // Installs `electron@1.0.0` (on the default trusted list) from a yarn.lock
  // that resolves it to `resolved`, and returns the migrated bun.lock.
  async function installFromYarnLock(ctx: TestCtx, resolved: string, integrity: string) {
    const { packageDir, packageJson, env } = ctx;
    await Promise.all([
      writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "electron": "1.0.0",
          },
        }),
      ),
      writeFile(
        join(packageDir, "yarn.lock"),
        `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


electron@1.0.0:
  version "1.0.0"
  resolved "${resolved}"
  integrity ${integrity}
`,
      ),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("migrated lockfile from yarn.lock");
    expect(err).not.toContain("error:");
    expect(await exists(join(packageDir, "node_modules", "electron", "package.json"))).toBeTrue();
    expect(exitCode).toBe(0);
    return { out, lockfile: await file(join(packageDir, "bun.lock")).text() };
  }

  // yarn v1 writes the tarball's sha1 as a URL fragment after registry tarball
  // URLs. Other producers of the format (bun's own `--yarn` output, registries
  // without a shasum) omit it. Both shapes describe the canonical registry
  // tarball for electron@1.0.0, so both must keep the default-trusted grant
  // after migration, exactly like an install that never had a yarn.lock.
  test.concurrent.each([
    ["with a sha1 fragment", "#f1b8bc2c23cd7e4f1500669dfaf8757578d2e391"],
    ["without a fragment", ""],
  ])("scripts run for the canonical registry tarball URL %s", async (_, fragment) => {
    using ctx = await setupTest();
    const canonicalUrl = `http://localhost:${verdaccio.port}/electron/-/electron-1.0.0.tgz`;

    const { out, lockfile } = await installFromYarnLock(ctx, `${canonicalUrl}${fragment}`, electronIntegrity);

    expect(out).not.toContain("Blocked");
    expect(await exists(join(ctx.packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
    // The migrated entry is an npm package whose tarball URL is the canonical
    // one for the configured registry, with yarn's fragment dropped.
    expect(lockfile).toContain(
      `"electron": ["electron@1.0.0", "${canonicalUrl}", { "hasInstallScript": true }, "${electronIntegrity}"]`,
    );
  });

  test.concurrent("scripts stay blocked when the yarn.lock points the name at another tarball", async () => {
    using ctx = await setupTest();
    // Same registry, but another package's tarball recorded under the
    // default-trusted name. Migration must keep that URL, so the canonical URL
    // check still denies the default grant.
    const otherUrl = `http://localhost:${verdaccio.port}/all-lifecycle-scripts/-/all-lifecycle-scripts-1.0.0.tgz`;

    const { lockfile } = await installFromYarnLock(
      ctx,
      `${otherUrl}#91cd0bd6a450b21db0078b9118c54bc0a27fccb7`,
      otherIntegrity,
    );

    expect(lockfile).toContain(
      `"electron": ["electron@1.0.0", "${otherUrl}", { "hasInstallScript": true }, "${otherIntegrity}"]`,
    );
    const electronDir = join(ctx.packageDir, "node_modules", "electron");
    expect(
      await Promise.all([
        exists(join(electronDir, "install.js")),
        exists(join(electronDir, "preinstall.txt")),
        exists(join(electronDir, "install.txt")),
        exists(join(electronDir, "postinstall.txt")),
      ]),
    ).toEqual([true, false, false, false]);
  });

  // Earlier versions of the migrator wrote yarn's `#sha1` into bun.lock itself.
  // The default grant needs the recorded URL to be the canonical one byte for
  // byte, so those lockfiles keep the scripts blocked, as they always did.
  test.concurrent.each([
    [
      "keeps blocking the canonical tarball",
      "electron/-/electron-1.0.0.tgz#f1b8bc2c23cd7e4f1500669dfaf8757578d2e391",
      electronIntegrity,
      false,
    ],
    [
      "keeps blocking another tarball",
      "all-lifecycle-scripts/-/all-lifecycle-scripts-1.0.0.tgz#91cd0bd6a450b21db0078b9118c54bc0a27fccb7",
      otherIntegrity,
      false,
    ],
  ])("a bun.lock already migrated with the #sha1 suffix %s", async (_, tarball, integrity, scriptsRun) => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;
    const url = `http://localhost:${verdaccio.port}/${tarball}`;

    await Promise.all([
      writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "electron": "1.0.0",
          },
        }),
      ),
      writeFile(
        join(packageDir, "bun.lock"),
        `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "foo",
      "dependencies": {
        "electron": "1.0.0",
      },
    },
  },
  "packages": {
    "electron": ["electron@1.0.0", "${url}", {}, "${integrity}"],
  }
}
`,
      ),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    expect(err).not.toContain("error:");
    const electronDir = join(packageDir, "node_modules", "electron");
    expect(
      await Promise.all([exists(join(electronDir, "package.json")), exists(join(electronDir, "preinstall.txt"))]),
    ).toEqual([true, scriptsRun]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("binary lockfile trusted dependency entries require an exact name match", async () => {
  using ctx = await setupTest();
  const { packageDir, packageJson, env } = ctx;

  // The binary lockfile (bun.lockb) stores trustedDependencies as truncated
  // 32-bit name hashes with no name. A hash-only entry must never grant
  // lifecycle-script trust to a different name that happens to collide with
  // it. These two distinct names share the truncated hash 0x6c4a82d1 under
  // `Wyhash11::hash(0, name) as u32` (same pair as "trustedDependencies entry
  // must match by name, not truncated hash" above).
  const trustedName = "pkg-xjd";
  const colliderName = "pkg-ztd";

  await verdaccio.writeBunfig(packageDir, { saveTextLockfile: false, linker: "hoisted" });

  const colliderPath = join(packageDir, "collider");
  await mkdir(colliderPath, { recursive: true });
  await writeFile(
    join(colliderPath, "package.json"),
    JSON.stringify({
      name: colliderName,
      version: "1.0.0",
      scripts: {
        postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
      },
    }),
  );

  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        [colliderName]: "file:./collider",
      },
      trustedDependencies: [trustedName],
    }),
  );

  // First install writes a binary bun.lockb whose trustedDependencies entry
  // for `pkg-xjd` is persisted as a hash with no name attached.
  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  let err = await stderr.text();
  let out = await stdout.text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(out).toContain("Blocked 1 postinstall");
  expect(await exists(join(packageDir, "bun.lockb"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeFalse();
  expect(await exited).toBe(0);

  // Reinstall from the binary lockfile. The hash-only entry loaded from disk
  // must still not grant trust to the colliding name.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).toContain("Blocked 1 postinstall");
  expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeFalse();
  expect(await exited).toBe(0);

  // A trustedDependencies entry that names the real package keeps working
  // across the same binary-lockfile round trip.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "bun.lockb"), { force: true });
  await writeFile(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        [colliderName]: "file:./collider",
      },
      trustedDependencies: [colliderName],
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).not.toContain("Blocked");
  expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeTrue();
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).not.toContain("Blocked");
  expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeTrue();
  expect(await exited).toBe(0);
});

test.concurrent(
  "lifecycle script trust for file: dependencies is keyed on the dependency alias, not the package's self-declared name",
  async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;

    // The user vets and trusts the names they wrote in `dependencies` /
    // `trustedDependencies`. A folder/tarball/git dependency installed under a
    // different alias must not inherit lifecycle-script trust just because the
    // package.json inside the dependency declares the trusted name for itself.
    const payloadDir = join(packageDir, "payload");
    await mkdir(payloadDir, { recursive: true });
    await writeFile(
      join(payloadDir, "package.json"),
      JSON.stringify({
        name: "my-native-addon",
        version: "1.0.0",
        scripts: {
          postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
        },
      }),
    );

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "unrelated-alias": "file:./payload",
        },
        trustedDependencies: ["my-native-addon"],
      }),
    );

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    let err = await stderr.text();
    let out = await stdout.text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(out).toContain("Blocked 1 postinstall");
    expect(await exists(join(packageDir, "node_modules", "unrelated-alias", "package.json"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "unrelated-alias", "postinstall-ran.txt"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "my-native-addon", "postinstall-ran.txt"))).toBeFalse();
    expect(await exited).toBe(0);

    // The same folder dependency declared under the alias the user actually
    // listed in trustedDependencies still runs its lifecycle scripts.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lock"), { force: true });
    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "my-native-addon": "file:./payload",
        },
        trustedDependencies: ["my-native-addon"],
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    }));

    err = await stderr.text();
    out = await stdout.text();
    expect(err).not.toContain("error:");
    expect(out).not.toContain("Blocked");
    expect(await exists(join(packageDir, "node_modules", "my-native-addon", "postinstall-ran.txt"))).toBeTrue();
    expect(await exited).toBe(0);
  },
);

test.concurrent(
  "trustedDependencies entries for non-npm dependencies only apply to dependencies declared by the root or a workspace",
  async () => {
    using ctx = await setupTest();
    const { packageDir, packageJson, env } = ctx;

    // A transitive dependency picks the aliases of its own dependencies. An alias
    // that happens to match an entry in the root's `trustedDependencies` must not
    // grant lifecycle-script trust to a tarball/git/folder package the root never
    // declared itself.
    const tarballUrl = `http://localhost:${verdaccio.port}/electron/-/electron-1.0.0.tgz`;
    const middleDir = join(packageDir, "middle");
    await mkdir(middleDir, { recursive: true });
    await writeFile(
      join(middleDir, "package.json"),
      JSON.stringify({
        name: "middle",
        version: "1.0.0",
        dependencies: {
          "trusted-native-addon": tarballUrl,
        },
      }),
    );

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "middle": "file:./middle",
        },
        trustedDependencies: ["trusted-native-addon"],
      }),
    );

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });

    let err = await stderr.text();
    let out = await stdout.text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    // The remote tarball was introduced by `middle`, not by the root, so its
    // preinstall must stay blocked even though the alias matches an entry in the
    // root's trustedDependencies.
    expect(out).toContain("Blocked 1 postinstall");
    expect(await exited).toBe(0);
    expect(await exists(join(packageDir, "node_modules", "trusted-native-addon", "preinstall.txt"))).toBeFalse();
    expect(
      await exists(
        join(packageDir, "node_modules", "middle", "node_modules", "trusted-native-addon", "preinstall.txt"),
      ),
    ).toBeFalse();

    // The same tarball declared by the root itself under the trusted alias still
    // runs its lifecycle scripts.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lock"), { force: true });
    await writeFile(
      packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "trusted-native-addon": tarballUrl,
        },
        trustedDependencies: ["trusted-native-addon"],
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    }));

    err = await stderr.text();
    out = await stdout.text();
    expect(err).not.toContain("error:");
    expect(out).not.toContain("Blocked");
    expect(await exited).toBe(0);
    expect(await exists(join(packageDir, "node_modules", "trusted-native-addon", "preinstall.txt"))).toBeTrue();
  },
);

// One source for who is trusted: the package.json files, for the installers and for `bun pm untrusted`, `trust` and
// `ls --trusted`. bun.lock only records whose scripts have run.
describe("the trusted set", () => {
  const linkers = ["hoisted", "isolated"] as const;
  type Linker = (typeof linkers)[number];

  type Files = Record<string, object | string>;

  async function project(linker: Linker, files: Files, bunfig: { [key: string]: boolean } = {}) {
    const ctx = await setupTest();
    await Promise.all([
      verdaccio.writeBunfig(ctx.packageDir, { linker, ...bunfig }),
      ...Object.entries(files).map(([path, contents]) =>
        write(join(ctx.packageDir, path), typeof contents === "string" ? contents : JSON.stringify(contents)),
      ),
    ]);
    return ctx;
  }

  async function bun(ctx: TestCtx, args: string[], env: Record<string, string> = {}, cwd = ctx.packageDir) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...ctx.env, ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  /** Where the linker puts a registry package that nothing nests. */
  const packageDirOf = (ctx: TestCtx, linker: Linker, name: string, version = "1.0.0", alias = name) =>
    linker === "hoisted"
      ? join(ctx.packageDir, "node_modules", alias)
      : join(ctx.packageDir, "node_modules", ".bun", `${name}@${version}`, "node_modules", name);

  const textOf = async (...path: string[]) => {
    const f = file(join(...path));
    return (await f.exists()) ? await f.text() : null;
  };

  async function recorded(ctx: TestCtx) {
    const list = (await file(join(ctx.packageDir, "bun.lock")).text()).match(/"trustedDependencies": \[([^\]]*)\]/);
    return {
      "package.json": (await file(ctx.packageJson).json()).trustedDependencies ?? null,
      "bun.lock": list ? [...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : null,
    };
  }

  const removeNodeModules = (ctx: TestCtx) =>
    rm(join(ctx.packageDir, "node_modules"), { recursive: true, force: true });

  test.concurrent.each(linkers)("an empty list keeps the default list off on every install (%s)", async linker => {
    using ctx = await project(linker, {
      "package.json": { name: "foo", dependencies: { electron: "1.0.0" }, trustedDependencies: [] },
    });

    for (const args of [["install"], ["install"], ["install", "--frozen-lockfile"], ["ci"]]) {
      await removeNodeModules(ctx);
      const { err, exitCode } = await bun(ctx, args);
      expect(err).not.toContain("error:");
      expect({
        args,
        installed: await exists(join(packageDirOf(ctx, linker, "electron"), "package.json")),
        ran: await exists(join(packageDirOf(ctx, linker, "electron"), "preinstall.txt")),
      }).toEqual({ args, installed: true, ran: false });
      expect(exitCode).toBe(0);
    }
    expect(await recorded(ctx)).toEqual({ "package.json": [], "bun.lock": [] });

    const untrusted = await bun(ctx, ["pm", "untrusted"]);
    expect(untrusted.out).toContain("electron @1.0.0");
    expect(untrusted.exitCode).toBe(0);
    const trusted = await bun(ctx, ["pm", "ls", "--trusted"]);
    expect(trusted.out).not.toContain("electron");
    expect(trusted.exitCode).toBe(0);
  });

  // A checkout without the workspace that declares `[]` has only bun.lock to learn it from (frozen-lockfile-pruned.test.ts).
  test.concurrent("bun.lock records an empty list, and only that one, for as long as it is declared", async () => {
    const manifest = { name: "foo", dependencies: { "no-deps": "1.0.0" } };
    using ctx = await project("hoisted", { "package.json": manifest });
    const install = async (trustedDependencies?: string[]) => {
      await write(ctx.packageJson, JSON.stringify({ ...manifest, trustedDependencies }));
      const { err, exitCode } = await bun(ctx, ["install"]);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      return { saved: err.includes("Saved lockfile"), lock: await file(join(ctx.packageDir, "bun.lock")).text() };
    };

    const { lock } = await install();
    expect(lock).not.toContain("trustedDependencies");
    const withEmptyList = lock.replace('  "packages": {', '  "trustedDependencies": [],\n  "packages": {');

    expect(await install(["not-installed"])).toEqual({ saved: false, lock });
    expect(await install([])).toEqual({ saved: true, lock: withEmptyList });
    expect(await install([])).toEqual({ saved: false, lock: withEmptyList });
    expect(await install()).toEqual({ saved: true, lock });
  });

  // It cannot record that the scripts ran, so every frozen install would run them again.
  test.concurrent.each(linkers)(
    "a frozen install runs the scripts of a newly trusted package only if it installs the package (%s)",
    async linker => {
      const manifest = { name: "foo", dependencies: { "lifecycle-postinstall": "1.0.0" } };
      using ctx = await project(linker, { "package.json": manifest });
      // The script writes "postinstall exists!" when it runs a second time.
      const marker = () => textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt");
      const frozen = async (args: string[]) => {
        const { err, exitCode } = await bun(ctx, args);
        expect(err).not.toContain("error:");
        expect(exitCode).toBe(0);
        return { args, marker: await marker(), "bun.lock": (await recorded(ctx))["bun.lock"] };
      };

      expect((await bun(ctx, ["install"])).out).toContain("Blocked 1 postinstall");
      await write(ctx.packageJson, JSON.stringify({ ...manifest, trustedDependencies: ["lifecycle-postinstall"] }));

      for (const args of [["install", "--frozen-lockfile"], ["ci"], ["install", "--production"]]) {
        expect(await frozen(args)).toEqual({ args, marker: null, "bun.lock": null });
      }

      await removeNodeModules(ctx);
      for (const args of [["install", "--frozen-lockfile"], ["ci"], ["install", "--production"]]) {
        expect(await frozen(args)).toEqual({ args, marker: "postinstall!", "bun.lock": null });
      }
    },
  );

  test.concurrent.each(linkers)(
    "an entry added after the first install runs the scripts of that package only, once (%s)",
    async linker => {
      const manifest = {
        name: "foo",
        dependencies: { "all-lifecycle-scripts": "1.0.0", "lifecycle-postinstall": "1.0.0" },
      };
      using ctx = await project(linker, { "package.json": manifest });
      const markers = async () => ({
        preinstall: await textOf(packageDirOf(ctx, linker, "all-lifecycle-scripts"), "preinstall.txt"),
        install: await textOf(packageDirOf(ctx, linker, "all-lifecycle-scripts"), "install.txt"),
        postinstall: await textOf(packageDirOf(ctx, linker, "all-lifecycle-scripts"), "postinstall.txt"),
        neighbour: await textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt"),
      });
      const ranOnce = { preinstall: "preinstall!", install: "install!", postinstall: "postinstall!", neighbour: null };

      expect((await bun(ctx, ["install"])).out).toContain("Blocked 4 postinstalls");
      expect(await markers()).toEqual({ preinstall: null, install: null, postinstall: null, neighbour: null });

      await write(ctx.packageJson, JSON.stringify({ ...manifest, trustedDependencies: ["all-lifecycle-scripts"] }));
      const install = await bun(ctx, ["install", "--concurrent-scripts=1"]);
      expect(install.err).not.toContain("error:");
      expect(await markers()).toEqual(ranOnce);
      expect((await recorded(ctx))["bun.lock"]).toEqual(["all-lifecycle-scripts"]);
      expect(install.exitCode).toBe(0);

      // Each script writes "<name> exists!" when it runs a second time.
      expect((await bun(ctx, ["install"])).err).not.toContain("Saved lockfile");
      expect(await markers()).toEqual(ranOnce);
    },
  );

  test.concurrent.each(linkers)(
    "an entry added to a workspace member after the first install runs the blocked scripts, once (%s)",
    async linker => {
      const member = { name: "member", version: "1.0.0", dependencies: { "lifecycle-postinstall": "1.0.0" } };
      using ctx = await project(linker, {
        "package.json": { name: "root", workspaces: ["packages/*"] },
        "packages/member/package.json": member,
      });
      const marker = () => textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt");

      let { out, err, exitCode } = await bun(ctx, ["install"]);
      expect(err).not.toContain("error:");
      expect(out).toContain("Blocked 1 postinstall");
      expect(await marker()).toBeNull();
      expect(exitCode).toBe(0);

      await write(
        join(ctx.packageDir, "packages", "member", "package.json"),
        JSON.stringify({ ...member, trustedDependencies: ["lifecycle-postinstall"] }),
      );
      ({ err, exitCode } = await bun(ctx, ["install"]));
      expect(err).not.toContain("error:");
      expect(await marker()).toBe("postinstall!");
      expect(await recorded(ctx)).toEqual({ "package.json": null, "bun.lock": ["lifecycle-postinstall"] });
      expect(exitCode).toBe(0);

      // The script writes "postinstall exists!" when it runs a second time.
      ({ err, exitCode } = await bun(ctx, ["install"]));
      expect(err).not.toContain("Saved lockfile");
      expect(await marker()).toBe("postinstall!");
      expect(exitCode).toBe(0);

      const untrusted = await bun(ctx, ["pm", "untrusted"]);
      expect(untrusted.out).toContain("Found 0 untrusted dependencies with scripts");
    },
  );

  test.concurrent.each(linkers)(
    "bun pm untrusted and trust skip workspaces, whose scripts always run (%s)",
    async linker => {
      using ctx = await project(linker, {
        "package.json": {
          name: "mono",
          workspaces: ["packages/*"],
          dependencies: { "@scope/a": "workspace:*", "lifecycle-postinstall": "1.0.0" },
        },
        "packages/a/package.json": {
          name: "@scope/a",
          version: "1.0.0",
          scripts: { postinstall: `${bunExe()} -e "require('fs').appendFileSync('postinstall.log', 'ran,')"` },
        },
      });
      const memberLog = () => textOf(ctx.packageDir, "packages", "a", "postinstall.log");

      const install = await bun(ctx, ["install"]);
      expect(install.err).not.toContain("error:");
      expect(install.out).toContain("Blocked 1 postinstall");
      expect(await memberLog()).toBe("ran,");
      expect(install.exitCode).toBe(0);

      const untrusted = await bun(ctx, ["pm", "untrusted"]);
      expect(untrusted.out).toContain("lifecycle-postinstall @1.0.0");
      expect(untrusted.out).not.toContain("@scope");
      expect(untrusted.exitCode).toBe(0);

      const named = await bun(ctx, ["pm", "trust", "@scope/a"]);
      expect(named.err).toContain("0 scripts ran");
      expect(named.exitCode).toBe(1);

      const all = await bun(ctx, ["pm", "trust", "--all"]);
      expect(all.err).not.toContain("error:");
      expect(all.out).toContain("1 script ran across 1 package");
      expect(all.exitCode).toBe(0);

      expect(await memberLog()).toBe("ran,");
      expect(await recorded(ctx)).toEqual({
        "package.json": ["lifecycle-postinstall"],
        "bun.lock": ["lifecycle-postinstall"],
      });
    },
  );

  test.concurrent.each(linkers)(
    "bun pm untrusted, trust and ls --trusted follow package.json when bun.lock is stale (%s)",
    async linker => {
      const manifest = { name: "foo", dependencies: { "lifecycle-postinstall": "1.0.0" } };
      using ctx = await project(linker, {
        "package.json": { ...manifest, trustedDependencies: ["lifecycle-postinstall"] },
      });
      const marker = () => textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt");

      expect((await bun(ctx, ["install"])).exitCode).toBe(0);
      expect(await marker()).toBe("postinstall!");
      expect((await bun(ctx, ["pm", "ls", "--trusted"])).out).toContain("lifecycle-postinstall@1.0.0");

      // Revoked. A frozen install blocks the script and leaves bun.lock, which still lists the name.
      await Promise.all([write(ctx.packageJson, JSON.stringify(manifest)), removeNodeModules(ctx)]);
      const frozen = await bun(ctx, ["install", "--frozen-lockfile"]);
      expect(frozen.out).toContain("1 package installed");
      expect(await marker()).toBeNull();
      expect(frozen.exitCode).toBe(0);
      expect(await recorded(ctx)).toEqual({ "package.json": null, "bun.lock": ["lifecycle-postinstall"] });

      expect((await bun(ctx, ["pm", "untrusted"])).out).toContain("lifecycle-postinstall @1.0.0");
      expect((await bun(ctx, ["pm", "ls", "--trusted"])).out).not.toContain("lifecycle-postinstall");

      const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall"]);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 script ran across 1 package");
      expect(await marker()).toBe("postinstall!");
      expect(trust.exitCode).toBe(0);
    },
  );

  test.concurrent("bun.lockb records hashes only, and bun pm untrusted / trust still know who is trusted", async () => {
    using ctx = await project(
      "hoisted",
      {
        "package.json": {
          name: "foo",
          dependencies: { "lifecycle-postinstall": "1.0.0" },
          trustedDependencies: ["lifecycle-postinstall"],
        },
      },
      { saveTextLockfile: false },
    );
    const marker = () => textOf(packageDirOf(ctx, "hoisted", "lifecycle-postinstall"), "postinstall.txt");

    expect((await bun(ctx, ["install"])).exitCode).toBe(0);
    expect(await exists(join(ctx.packageDir, "bun.lockb"))).toBeTrue();
    expect(await marker()).toBe("postinstall!");

    expect((await bun(ctx, ["pm", "untrusted"])).out).toContain("Found 0 untrusted dependencies with scripts");
    const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall"]);
    expect(trust.err).toContain("0 scripts ran");
    expect(await marker()).toBe("postinstall!");
    expect(trust.exitCode).toBe(1);
  });

  describe("an npm: alias is trusted by the name of its package", () => {
    const manifest = { name: "foo", dependencies: { zzz: "npm:lifecycle-postinstall@1.0.0" } };
    const marker = (ctx: TestCtx, linker: Linker) =>
      textOf(packageDirOf(ctx, linker, "lifecycle-postinstall", "1.0.0", "zzz"), "postinstall.txt");

    test.concurrent.each(linkers)("bun pm untrusted and trust (%s)", async linker => {
      using ctx = await project(linker, { "package.json": manifest });
      expect((await bun(ctx, ["install"])).out).toContain("Blocked 1 postinstall");

      expect((await bun(ctx, ["pm", "untrusted"])).out).toContain(' alias of "lifecycle-postinstall"\n');

      // An install does not trust the alias, so the command does not write it.
      const byAlias = await bun(ctx, ["pm", "trust", "zzz"]);
      expect(byAlias.err).toContain("0 scripts ran");
      expect(byAlias.err).toContain(
        `"zzz" is an alias of "lifecycle-postinstall", run 'bun pm trust "lifecycle-postinstall"' to trust it`,
      );
      expect(await marker(ctx, linker)).toBeNull();
      expect(byAlias.exitCode).toBe(1);

      const byName = await bun(ctx, ["pm", "trust", "lifecycle-postinstall"]);
      expect(byName.err).not.toContain("error:");
      expect(byName.out).toContain("1 script ran across 1 package");
      expect(await marker(ctx, linker)).toBe("postinstall!");
      expect(byName.exitCode).toBe(0);
      expect(await recorded(ctx)).toEqual({
        "package.json": ["lifecycle-postinstall"],
        "bun.lock": ["lifecycle-postinstall"],
      });

      // A fresh install respects what the command wrote, and there's nothing left to report.
      await removeNodeModules(ctx);
      const install = await bun(ctx, ["install"]);
      expect(install.out).not.toContain("Blocked");
      expect(install.err).not.toContain("Saved lockfile");
      expect(await marker(ctx, linker)).toBe("postinstall!");
      expect((await bun(ctx, ["pm", "untrusted"])).out).toContain("Found 0 untrusted dependencies with scripts");
    });

    test.concurrent.each(linkers)("an entry added after the first install (%s)", async linker => {
      using ctx = await project(linker, { "package.json": manifest });
      expect((await bun(ctx, ["install"])).out).toContain("Blocked 1 postinstall");

      await write(ctx.packageJson, JSON.stringify({ ...manifest, trustedDependencies: ["lifecycle-postinstall"] }));
      const install = await bun(ctx, ["install"]);
      expect(install.err).not.toContain("error:");
      expect(await marker(ctx, linker)).toBe("postinstall!");
      expect((await recorded(ctx))["bun.lock"]).toEqual(["lifecycle-postinstall"]);
      expect(install.exitCode).toBe(0);

      expect((await bun(ctx, ["install"])).err).not.toContain("Saved lockfile");
      expect(await marker(ctx, linker)).toBe("postinstall!");
    });

    // The arm for a package that gets installed and the arm for one that is already there record the same.
    test.concurrent.each(linkers)("bun add --trust, fresh and over an existing node_modules (%s)", async linker => {
      const expected = { "package.json": ["lifecycle-postinstall"], "bun.lock": ["lifecycle-postinstall"] };

      using fresh = await project(linker, { "package.json": { name: "foo" } });
      let add = await bun(fresh, ["add", "--trust", "zzz@npm:lifecycle-postinstall@1.0.0"]);
      expect(add.err).not.toContain("error:");
      expect(await marker(fresh, linker)).toBe("postinstall!");
      expect(await recorded(fresh)).toEqual(expected);
      expect(add.exitCode).toBe(0);

      using existing = await project(linker, { "package.json": manifest });
      expect((await bun(existing, ["install"])).out).toContain("Blocked 1 postinstall");
      add = await bun(existing, ["add", "--trust", "zzz@npm:lifecycle-postinstall@1.0.0"]);
      expect(add.err).not.toContain("error:");
      expect(await marker(existing, linker)).toBe("postinstall!");
      expect(await recorded(existing)).toEqual(expected);
      expect(add.exitCode).toBe(0);
    });
  });

  describe("bun pm untrusted and trust under the isolated linker", () => {
    test.concurrent("a script finds the bins of its package's own dependencies", async () => {
      using ctx = await project("isolated", {
        "package.json": { name: "foo", dependencies: { "uses-what-bin": "1.0.0" } },
      });
      expect((await bun(ctx, ["install"])).out).toContain("Blocked 1 postinstall");

      const trust = await bun(ctx, ["pm", "trust", "uses-what-bin"]);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain(
        `.${sep}${join("node_modules", ".bun", "uses-what-bin@1.0.0", "node_modules", "uses-what-bin")} @1.0.0`,
      );
      expect(trust.out).toContain("1 script ran across 1 package");
      expect(await exists(join(packageDirOf(ctx, "isolated", "uses-what-bin"), "what-bin.txt"))).toBeTrue();
      expect(trust.exitCode).toBe(0);
    });

    test.concurrent("a workspace member's and a transitive dependency are found", async () => {
      using ctx = await project("isolated", {
        "package.json": { name: "root", workspaces: ["packages/*"] },
        "packages/b/package.json": {
          name: "b",
          version: "1.0.0",
          dependencies: { "lifecycle-postinstall": "1.0.0", "one-fixed-dep-scripted": "1.0.0" },
        },
      });
      expect((await bun(ctx, ["install"])).exitCode).toBe(0);

      const untrusted = await bun(ctx, ["pm", "untrusted"]);
      // `no-deps-scripted` is a dependency of `one-fixed-dep-scripted`.
      for (const name of ["lifecycle-postinstall", "one-fixed-dep-scripted", "no-deps-scripted"]) {
        expect(untrusted.out).toContain(
          `${join("node_modules", ".bun", `${name}@1.0.0`, "node_modules", name)} @1.0.0`,
        );
      }
      expect(untrusted.exitCode).toBe(0);

      const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall"]);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 script ran across 1 package");
      expect(trust.out).toContain("2 packages with blocked scripts");
      expect(await textOf(packageDirOf(ctx, "isolated", "lifecycle-postinstall"), "postinstall.txt")).toBe(
        "postinstall!",
      );
      expect((await recorded(ctx))["package.json"]).toEqual(["lifecycle-postinstall"]);
      expect(trust.exitCode).toBe(0);
    });

    // It has no folder in the store.
    test.concurrent.each([
      {
        title: "a path in the root",
        resolution: "link:./vendor/tok",
        files: { "package.json": { name: "foo", dependencies: { tok: "link:./vendor/tok" } } },
      },
      {
        title: "a path in a workspace member",
        resolution: "link:./vendor/tok",
        files: {
          "package.json": { name: "foo", workspaces: ["packages/*"] },
          "packages/a/package.json": { name: "a", dependencies: { tok: "link:../../vendor/tok" } },
        },
      },
      {
        title: "a name registered with bun link",
        resolution: "link:tok",
        files: { "package.json": { name: "foo", dependencies: { tok: "link:tok" } } },
      },
    ])("a link: dependency is found: $title", async ({ resolution, files }) => {
      using ctx = await project("isolated", {
        ...files,
        "vendor/tok/package.json": {
          name: "tok",
          version: "1.0.0",
          scripts: { postinstall: "echo built > built.txt" },
        },
      });
      const env = { BUN_INSTALL_GLOBAL_DIR: join(ctx.packageDir, "global") };
      const tok = join(ctx.packageDir, "vendor", "tok");
      if (resolution === "link:tok") {
        expect((await bun(ctx, ["link"], env, tok)).exitCode).toBe(0);
        // There it is the project's own script.
        await rm(join(tok, "built.txt"), { force: true });
      }

      const install = await bun(ctx, ["install"], env);
      expect(install.out).toContain("Blocked 1 postinstall");
      expect(await textOf(tok, "built.txt")).toBeNull();
      expect(install.exitCode).toBe(0);

      const untrusted = await bun(ctx, ["pm", "untrusted"], env);
      expect(untrusted.out).toContain(` @${resolution}\n`);
      expect(untrusted.out).toContain("[postinstall]: echo built > built.txt");
      expect(untrusted.exitCode).toBe(0);

      const trust = await bun(ctx, ["pm", "trust", "tok"], env);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 script ran across 1 package");
      expect((await textOf(tok, "built.txt"))?.trim()).toBe("built");
      expect(await recorded(ctx)).toEqual({ "package.json": ["tok"], "bun.lock": ["tok"] });
      expect(trust.exitCode).toBe(0);

      await rm(join(tok, "built.txt"));
      const again = await bun(ctx, ["install"], env);
      expect(again.err).not.toContain("error:");
      expect(await textOf(tok, "built.txt")).toBeNull();
      expect(again.exitCode).toBe(0);
    });

    test.concurrent("nothing runs inside the global store, which other projects share", async () => {
      const manifest = { name: "foo", dependencies: { "lifecycle-postinstall": "1.0.0" } };
      using ctx = await project(
        "isolated",
        { "package.json": manifest, "other/package.json": manifest },
        { globalStore: true },
      );
      const other = join(ctx.packageDir, "other");
      await write(join(other, "bunfig.toml"), file(join(ctx.packageDir, "bunfig.toml")));
      const entry = join("node_modules", ".bun", "lifecycle-postinstall@1.0.0");
      const marker = join(entry, "node_modules", "lifecycle-postinstall", "postinstall.txt");

      expect((await bun(ctx, ["install"])).exitCode).toBe(0);
      expect((await bun(ctx, ["install"], {}, other)).exitCode).toBe(0);
      expect(lstatSync(join(ctx.packageDir, entry)).isSymbolicLink()).toBeTrue();

      expect((await bun(ctx, ["pm", "untrusted"])).out).toContain("lifecycle-postinstall @1.0.0");

      const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall"]);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 trusted package linked from the global store: run `bun install`");
      expect(trust.out).not.toContain("script ran");
      expect([await textOf(ctx.packageDir, marker), await textOf(other, marker)]).toEqual([null, null]);
      expect(await recorded(ctx)).toEqual({ "package.json": ["lifecycle-postinstall"], "bun.lock": null });
      expect(trust.exitCode).toBe(0);

      // The install gives the trusted package its own directory and runs the script there.
      const install = await bun(ctx, ["install"]);
      expect(install.err).not.toContain("error:");
      expect(lstatSync(join(ctx.packageDir, entry)).isSymbolicLink()).toBeFalse();
      expect([await textOf(ctx.packageDir, marker), await textOf(other, marker)]).toEqual(["postinstall!", null]);
      expect((await recorded(ctx))["bun.lock"]).toEqual(["lifecycle-postinstall"]);
      expect(install.exitCode).toBe(0);
    });
  });

  test.concurrent.each(linkers)(
    "bun pm trust runs nothing and writes nothing when scripts are turned off (%s)",
    async linker => {
      using ctx = await project(linker, {
        "package.json": { name: "foo", dependencies: { "lifecycle-postinstall": "1.0.0" } },
      });
      expect((await bun(ctx, ["install"])).exitCode).toBe(0);

      for (const [args, env] of [
        [["--ignore-scripts"], {}],
        [[], { npm_config_ignore_scripts: "true" }],
      ] as [string[], Record<string, string>][]) {
        const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall", ...args], env);
        expect(trust.err).toContain("error: lifecycle scripts are disabled (ignore-scripts)");
        expect(await textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt")).toBeNull();
        expect(await recorded(ctx)).toEqual({ "package.json": null, "bun.lock": null });
        expect(trust.exitCode).toBe(1);
      }
    },
  );

  test.concurrent.each(linkers)(
    "bun pm trust runs nothing and writes nothing with --frozen-lockfile (%s)",
    async linker => {
      using ctx = await project(linker, {
        "package.json": { name: "foo", dependencies: { "lifecycle-postinstall": "1.0.0" } },
      });
      expect((await bun(ctx, ["install"])).exitCode).toBe(0);

      const trust = await bun(ctx, ["pm", "trust", "lifecycle-postinstall", "--frozen-lockfile"]);
      expect(trust.err).toContain("error: lockfile is frozen");
      expect(await textOf(packageDirOf(ctx, linker, "lifecycle-postinstall"), "postinstall.txt")).toBeNull();
      expect(await recorded(ctx)).toEqual({ "package.json": null, "bun.lock": null });
      expect(trust.exitCode).toBe(1);
    },
  );

  describe.each(linkers)("bun.lock records which packages have install scripts (%s)", linker => {
    const files = {
      "package.json": {
        name: "foo",
        dependencies: { "lifecycle-postinstall": "1.0.0", "no-deps": "1.0.0", folder: "file:./folder" },
      },
      "folder/package.json": { name: "folder", version: "1.0.0", scripts: { install: "echo built" } },
    };
    const blocked = "Blocked 2 postinstalls. Run `bun pm untrusted` for details.";
    const lockOf = (ctx: TestCtx) => file(join(ctx.packageDir, "bun.lock")).text();

    test.concurrent("so an install from it reports the blocked scripts", async () => {
      using ctx = await project(linker, files);
      expect((await bun(ctx, ["install"])).out).toContain(blocked);

      const lock = await lockOf(ctx);
      const { packages } = Bun.JSONC.parse(lock) as { packages: Record<string, unknown[]> };
      expect({
        "lifecycle-postinstall": packages["lifecycle-postinstall"][2],
        "no-deps": packages["no-deps"][2],
        folder: packages.folder[1],
      }).toEqual({
        "lifecycle-postinstall": { hasInstallScript: true },
        "no-deps": {},
        folder: { hasInstallScript: true },
      });

      for (const args of [["install"], ["install", "--frozen-lockfile"], ["ci"]]) {
        await removeNodeModules(ctx);
        const { out, err, exitCode } = await bun(ctx, args);
        expect(err).not.toContain("error:");
        expect(out).toContain(blocked);
        expect(await lockOf(ctx)).toBe(lock);
        expect(exitCode).toBe(0);
      }
    });

    test.concurrent("a bun.lock from before is installed as it is", async () => {
      using ctx = await project(linker, files);
      expect((await bun(ctx, ["install"])).exitCode).toBe(0);
      const lock = (await lockOf(ctx)).replaceAll(`{ "hasInstallScript": true }`, "{}");
      expect(lock).not.toContain("hasInstallScript");
      await write(join(ctx.packageDir, "bun.lock"), lock);

      for (const [args, fresh] of [
        [["install"], false],
        [["install", "--frozen-lockfile"], false],
        [["install"], true],
        [["ci"], true],
      ] as const) {
        if (fresh) await removeNodeModules(ctx);
        const { err, exitCode } = await bun(ctx, [...args]);
        expect(err).not.toContain("error:");
        expect(await lockOf(ctx)).toBe(lock);
        expect(exitCode).toBe(0);
      }
    });
  });

  describe.each(linkers)("the scripts that the trust commands run (%s)", linker => {
    // Appends `id` to $SCRIPT_RUNS.
    const scripted = (name: string, id: string) => ({
      name,
      version: "1.0.0",
      scripts: { postinstall: `echo ${id} >> "$SCRIPT_RUNS"` },
    });
    const runsEnv = (ctx: TestCtx) => ({ SCRIPT_RUNS: join(ctx.packageDir, "runs.txt") });
    const runs = async (ctx: TestCtx) =>
      ((await textOf(ctx.packageDir, "runs.txt")) ?? "").split(/\s+/).filter(Boolean).sort();
    const cannot = "cannot trust by name: add it to your package.json dependencies";

    test.concurrent.each([
      ["pm", "trust", "sharp", "--omit", "dev"],
      ["pm", "trust", "--omit", "dev", "sharp"],
      ["pm", "--omit", "dev", "trust", "sharp"],
      ["pm", "trust", "sharp", "--cache-dir", "cache"],
    ])("the names are the positional arguments: bun %s %s %s %s %s", async (...args) => {
      const names = ["sharp", "dev", "cache"];
      using ctx = await project(linker, {
        "package.json": {
          name: "foo",
          dependencies: Object.fromEntries(names.map(name => [name, `file:./deps/${name}`])),
        },
        ...Object.fromEntries(names.map(name => [`deps/${name}/package.json`, scripted(name, name)])),
      });
      expect((await bun(ctx, ["install"], runsEnv(ctx))).exitCode).toBe(0);

      const trust = await bun(ctx, args, runsEnv(ctx));
      expect(trust.err).not.toContain("error:");
      expect(await runs(ctx)).toEqual(["sharp"]);
      expect(await recorded(ctx)).toEqual({ "package.json": ["sharp"], "bun.lock": ["sharp"] });
      expect(trust.exitCode).toBe(0);
    });

    // `host` has its own `addon`, and a `native` that the project does not declare.
    const hostFiles = {
      "addon/package.json": scripted("addon", "own"),
      "host/package.json": {
        name: "host",
        version: "1.0.0",
        dependencies: { addon: "file:../other", native: "file:../native" },
      },
      "other/package.json": scripted("addon", "other"),
      "native/package.json": scripted("native", "native"),
    };

    test.concurrent("bun pm trust runs the scripts that an install runs once the name is listed", async () => {
      using ctx = await project(linker, {
        "package.json": { name: "foo", dependencies: { addon: "file:./addon", host: "file:./host" } },
        ...hostFiles,
      });
      const env = runsEnv(ctx);
      expect((await bun(ctx, ["install"], env)).exitCode).toBe(0);

      const untrusted = await bun(ctx, ["pm", "untrusted"], env);
      expect(untrusted.out.split("[postinstall]").length - 1).toBe(3);
      expect(untrusted.out.split(cannot).length - 1).toBe(2);
      expect(untrusted.exitCode).toBe(0);

      const trust = await bun(ctx, ["pm", "trust", "addon"], env);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 script ran across 1 package");
      expect(trust.out).toContain("2 packages with blocked scripts");
      expect(await runs(ctx)).toEqual(["own"]);
      expect(trust.exitCode).toBe(0);

      for (const args of [["native"], ["addon"], ["--all"]]) {
        const refused = await bun(ctx, ["pm", "trust", ...args], env);
        expect(refused.err).toContain("error: 0 scripts ran");
        expect(refused.err).toContain(`"${args[0] === "--all" ? "native" : args[0]}" ${cannot}`);
        expect(await runs(ctx)).toEqual(["own"]);
        expect(await recorded(ctx)).toEqual({ "package.json": ["addon"], "bun.lock": ["addon"] });
        expect(refused.exitCode).toBe(1);
      }

      await removeNodeModules(ctx);
      const install = await bun(ctx, ["install"], env);
      expect(install.err).not.toContain("error:");
      expect(await runs(ctx)).toEqual(["own", "own"]);
      expect(install.exitCode).toBe(0);
    });

    test.concurrent("bun pm trust --all runs the blocked scripts, and none of a trusted package's", async () => {
      using ctx = await project(linker, {
        "package.json": {
          name: "foo",
          dependencies: { addon: "file:./addon", built: "file:./built", off: "file:./off" },
          trustedDependencies: ["built", "off"],
          ignoreScripts: ["off"],
        },
        "addon/package.json": scripted("addon", "addon"),
        "built/package.json": scripted("built", "built"),
        "off/package.json": scripted("off", "off"),
      });
      const env = runsEnv(ctx);
      expect((await bun(ctx, ["install"], env)).exitCode).toBe(0);
      expect(await runs(ctx)).toEqual(["built"]);

      const trust = await bun(ctx, ["pm", "trust", "--all"], env);
      expect(trust.err).not.toContain("error:");
      expect(trust.out).toContain("1 script ran across 1 package");
      expect(await runs(ctx)).toEqual(["addon", "built"]);
      expect((await recorded(ctx))["package.json"]).toEqual(["addon", "built", "off"]);
      expect(trust.exitCode).toBe(0);
    });

    test.concurrent("bun add --trust runs what later installs run", async () => {
      using ctx = await project(linker, { "package.json": { name: "foo" }, ...hostFiles });
      const env = runsEnv(ctx);

      const add = await bun(ctx, ["add", "--trust", "host@file:./host", "addon@file:./addon"], env);
      expect(add.err).not.toContain("error:");
      expect(await runs(ctx)).toEqual(["own"]);
      expect(await recorded(ctx)).toEqual({ "package.json": ["addon"], "bun.lock": ["addon"] });
      expect(add.exitCode).toBe(0);

      await removeNodeModules(ctx);
      const install = await bun(ctx, ["install"], env);
      expect(install.err).not.toContain("error:");
      expect(await runs(ctx)).toEqual(["own", "own"]);
      expect(install.exitCode).toBe(0);
    });

    test.concurrent("a package that another one ships inside itself is skipped, like in an install", async () => {
      using ctx = await project(linker, {
        "package.json": { name: "foo", dependencies: { host: "file:./host.tgz" } },
      });
      await write(
        join(ctx.packageDir, "host.tgz"),
        await new Bun.Archive(
          {
            "package/package.json": JSON.stringify({
              name: "host",
              version: "1.0.0",
              dependencies: { "no-deps": "1.0.0" },
              bundledDependencies: ["no-deps"],
            }),
            "package/node_modules/no-deps/package.json": JSON.stringify(scripted("no-deps", "shipped")),
          },
          { compress: "gzip" },
        ).bytes(),
      );
      const env = runsEnv(ctx);
      const install = await bun(ctx, ["install"], env);
      expect(install.err).not.toContain("error:");
      expect(install.exitCode).toBe(0);

      expect((await bun(ctx, ["pm", "untrusted"], env)).out).toContain("Found 0 untrusted dependencies with scripts");
      const trust = await bun(ctx, ["pm", "trust", "no-deps"], env);
      expect(trust.err).toContain("error: 0 scripts ran");
      expect(await runs(ctx)).toEqual([]);
      expect(await recorded(ctx)).toEqual({ "package.json": null, "bun.lock": null });
      expect(trust.exitCode).toBe(1);
    });
  });

  describe("npm_config_ignore_scripts", () => {
    const manifest = {
      name: "foo",
      scripts: { postinstall: `${bunExe()} -e "require('fs').writeFileSync('root.txt', 'ran')"` },
      dependencies: { "lifecycle-postinstall": "1.0.0" },
      trustedDependencies: ["lifecycle-postinstall"],
    };
    const ran = async (ctx: TestCtx) => ({
      root: await exists(join(ctx.packageDir, "root.txt")),
      dependency: await exists(join(packageDirOf(ctx, "hoisted", "lifecycle-postinstall"), "postinstall.txt")),
    });

    test.concurrent.each([
      ["npm_config_ignore_scripts", "true"],
      ["NPM_CONFIG_IGNORE_SCRIPTS", "true"],
      ["npm_config_ignore_scripts", "1"],
      ["npm_config_ignore_scripts", "no"],
      ["npm_config_ignore_scripts", " "],
    ])("%s=%s turns scripts off", async (name, value) => {
      using ctx = await project("hoisted", { "package.json": manifest });
      const { err, exitCode } = await bun(ctx, ["install"], { [name]: value });
      expect(err).not.toContain("error:");
      expect(await ran(ctx)).toEqual({ root: false, dependency: false });
      expect(exitCode).toBe(0);
    });

    // Read like `ignore-scripts=<value>` in .npmrc, but for the empty value: npm skips such a variable.
    test.concurrent.each(["false", "0", "", " false ", "null", "undefined", "00", "0x0"])(
      "%j leaves scripts on",
      async value => {
        using ctx = await project("hoisted", { "package.json": manifest });
        const { exitCode } = await bun(ctx, ["install"], { npm_config_ignore_scripts: value });
        expect(await ran(ctx)).toEqual({ root: true, dependency: true });
        expect(exitCode).toBe(0);
      },
    );

    // It can only turn scripts off. If a config file or the flag turned them off, they stay off.
    test.concurrent.each([
      [".npmrc", { ".npmrc": "ignore-scripts=true\n" }, []],
      ["--ignore-scripts", {}, ["--ignore-scripts"]],
    ] as [string, Record<string, string>, string[]][])("false does not undo %s", async (_, files, args) => {
      using ctx = await project("hoisted", { "package.json": manifest, ...files });
      const { exitCode } = await bun(ctx, ["install", ...args], {
        npm_config_ignore_scripts: "false",
        NPM_CONFIG_IGNORE_SCRIPTS: "0",
      });
      expect(await ran(ctx)).toEqual({ root: false, dependency: false });
      expect(exitCode).toBe(0);
    });

    test.concurrent("the project's .env file does not set it", async () => {
      using ctx = await project("hoisted", { "package.json": manifest, ".env": "npm_config_ignore_scripts=true\n" });
      const { exitCode } = await bun(ctx, ["install"]);
      expect(await ran(ctx)).toEqual({ root: true, dependency: true });
      expect(exitCode).toBe(0);
    });
  });

  // Nobody trusts `payload`, and it has no script. Its `bin` has the name of a command that `native`, which is trusted,
  // runs.
  describe.skipIf(isWindows)("a bin of another package does not replace a command inside a trusted script", () => {
    const files = (script: "preinstall" | "postinstall", trusted: boolean) => ({
      "package.json": {
        name: "foo",
        scripts: { setup: `${bunExe()} install` },
        dependencies: { native: "file:./native", payload: "file:./payload" },
        trustedDependencies: trusted ? ["native"] : [],
      },
      "native/package.json": { name: "native", version: "1.0.0", scripts: { [script]: "uname > built.txt" } },
      "payload/package.json": { name: "payload", version: "1.0.0", bin: { uname: "run.sh" } },
      "payload/run.sh": "#!/bin/sh\necho planted\n",
    });
    const built = (ctx: TestCtx) => textOf(ctx.packageDir, "node_modules", "native", "built.txt");

    test.concurrent.each(["preinstall", "postinstall"] as const)("bun install, %s", async script => {
      using ctx = await project("hoisted", files(script, true));
      const { err, exitCode } = await bun(ctx, ["install"]);
      expect(err).not.toContain("error:");
      expect(await exists(join(ctx.packageDir, "node_modules", ".bin", "uname"))).toBeTrue();
      expect(await built(ctx)).toBe(`${osType()}\n`);
      expect(exitCode).toBe(0);
    });

    // `bun run` puts the project's `node_modules/.bin` in front of the PATH that the install inherits.
    test.concurrent("bun install started by bun run", async () => {
      using ctx = await project("hoisted", files("postinstall", true));
      // The link exists before the script runs.
      expect((await bun(ctx, ["install", "--ignore-scripts"])).exitCode).toBe(0);
      await rm(join(ctx.packageDir, "node_modules", "native"), { recursive: true, force: true });
      const { err, exitCode } = await bun(ctx, ["run", "setup"]);
      expect(err).not.toContain("error:");
      expect(await built(ctx)).toBe(`${osType()}\n`);
      expect(exitCode).toBe(0);
    });

    // The way a shell or a tool writes it from `$PWD`.
    test.concurrent("that directory in front of PATH, spelled through a link", async () => {
      using ctx = await project("hoisted", files("postinstall", true));
      expect((await bun(ctx, ["install", "--ignore-scripts"])).exitCode).toBe(0);
      await rm(join(ctx.packageDir, "node_modules", "native"), { recursive: true, force: true });
      await symlink(ctx.packageDir, join(ctx.packageDir, "link"));
      const { err, exitCode } = await bun(ctx, ["install"], {
        PATH: `${join(ctx.packageDir, "link", "node_modules", ".bin")}:${ctx.env.PATH}`,
      });
      expect(err).not.toContain("error:");
      expect(await built(ctx)).toBe(`${osType()}\n`);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun pm trust", async () => {
      using ctx = await project("hoisted", files("postinstall", false));
      expect((await bun(ctx, ["install"])).out).toContain("Blocked 1 postinstall");
      const { err, exitCode } = await bun(ctx, ["pm", "trust", "native"]);
      expect(err).not.toContain("error:");
      expect(await built(ctx)).toBe(`${osType()}\n`);
      expect(exitCode).toBe(0);
    });

    // The project chose its direct dependencies' bins for its own scripts.
    test.concurrent("the project's own scripts still find the project's bins first", async () => {
      const { "package.json": manifest, ...rest } = files("postinstall", false);
      using ctx = await project("hoisted", {
        ...rest,
        "package.json": { ...manifest, scripts: { postinstall: "uname > built.txt" } },
      });
      expect((await bun(ctx, ["install"])).exitCode).toBe(0);
      expect(await textOf(ctx.packageDir, "built.txt")).toBe("planted\n");
    });
  });

  // A working directory keeps the case it was typed in, and `bun run` writes PATH from it.
  test.concurrent.skipIf(!isWindows)(
    "the project's node_modules/.bin comes last for a dependency's script, no matter how the working directory is spelled",
    async () => {
      const printPath = `${bunExe()} -e 'await Bun.write("path.txt", String(process.env.PATH))'`;
      using ctx = await project("hoisted", {
        "package.json": {
          name: "foo",
          scripts: { setup: `${bunExe()} install` },
          dependencies: { native: "file:./native" },
          trustedDependencies: ["native"],
        },
        "native/package.json": { name: "native", version: "1.0.0", scripts: { postinstall: printPath } },
      });
      const { err, exitCode } = await bun(ctx, ["run", "setup"], {}, ctx.packageDir.toUpperCase());
      expect(err).not.toContain("error:");

      const path = (await textOf(ctx.packageDir, "node_modules", "native", "path.txt"))!.toLowerCase().split(";");
      const inherited = process.env.PATH!.toLowerCase().split(";")[0];
      expect(path).toContain(inherited);
      expect(path.indexOf(join(ctx.packageDir, "node_modules", ".bin").toLowerCase())).toBeGreaterThan(
        path.indexOf(inherited),
      );
      expect(exitCode).toBe(0);
    },
  );
});

// Every subcommand below prints the flag table shared by the install family. The behavior the
// entry describes is covered by "ignore-scripts is read from npmrc" (above) and "--ignore-scripts
// should skip lifecycle scripts" (below): both install a trustedDependencies package.
test.concurrent.each([
  "install",
  "add",
  "update",
  "remove",
  "link",
  "unlink",
  "patch",
  "patch-commit",
  "outdated",
  "publish",
  "info",
])("bun %s --help says --ignore-scripts also skips the scripts of trusted dependencies", async subcommand => {
  await using proc = spawn({
    cmd: [bunExe(), subcommand, "--help"],
    env: baseEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const entry = stdout.split(/\r?\n/).find(line => line.includes("--ignore-scripts"));
  expect(entry).toBeDefined();
  expect(entry).toContain("trusted dependencies");
  // The wording from before trustedDependencies existed.
  expect(entry).not.toContain("dependency scripts are never run");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

describe.concurrent("--dry-run and root lifecycle scripts", () => {
  const none = [false, false, false];
  const all = [true, true, true];

  // Writes a project with one dependency and three root scripts. Each script leaves a marker file.
  async function writeProject(ctx: TestCtx, preinstall = "echo preinstall > preinstall.txt") {
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
        scripts: {
          preinstall,
          postinstall: "echo postinstall > postinstall.txt",
          prepare: "echo prepare > prepare.txt",
        },
      }),
    );
    const markers = ["preinstall.txt", "postinstall.txt", "prepare.txt"].map(name => join(ctx.packageDir, name));

    // Reports which markers the command left, then removes them so that the next command starts clean.
    return async function run(args: string[], env: Record<string, string> = {}) {
      const { stderr, exited } = spawn({
        cmd: [bunExe(), ...args],
        cwd: ctx.packageDir,
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env: { ...ctx.env, ...env },
      });

      const [err, exitCode] = await Promise.all([stderr.text(), exited]);
      const scriptsRan = await Promise.all(markers.map(marker => exists(marker)));
      await Promise.all(markers.map(marker => rm(marker, { force: true })));
      return { err, result: { args, scriptsRan, exitCode } };
    };
  }

  test("a dry run without a lockfile runs none", async () => {
    using ctx = await setupTest();
    const run = await writeProject(ctx);

    for (const args of [
      ["install", "--dry-run"],
      ["install", "--frozen-lockfile", "--dry-run"],
    ]) {
      const { err, result } = await run(args);
      expect(err).not.toContain("error:");
      expect(result).toEqual({ args, scriptsRan: none, exitCode: 0 });
    }
    expect(await exists(join(ctx.packageDir, "bun.lock"))).toBe(false);
  });

  test("a dry run of each install command runs none", async () => {
    using ctx = await setupTest();
    const run = await writeProject(ctx);

    // The real install writes the lockfile that the dry runs load.
    expect((await run(["install"])).result).toEqual({ args: ["install"], scriptsRan: all, exitCode: 0 });
    const lockfile = await file(join(ctx.packageDir, "bun.lock")).text();
    const manifest = await file(ctx.packageJson).text();

    for (const args of [
      ["install", "--dry-run"],
      ["install", "--dry-run", "--silent"],
      ["install", "--frozen-lockfile", "--dry-run"],
      ["install", "--filter", "foo", "--dry-run"],
      ["ci", "--dry-run"],
      ["update", "--dry-run"],
      ["add", "a-dep", "--dry-run"],
      ["remove", "no-deps", "--dry-run"],
    ]) {
      const { err, result } = await run(args);
      expect(err).not.toContain("error:");
      expect(result).toEqual({ args, scriptsRan: none, exitCode: 0 });
      expect(await file(join(ctx.packageDir, "bun.lock")).text()).toBe(lockfile);
      expect(await file(ctx.packageJson).text()).toBe(manifest);
    }
  });

  test("--frozen-lockfile --dry-run still fails when package.json and bun.lock disagree", async () => {
    using ctx = await setupTest();
    const run = await writeProject(ctx);
    expect((await run(["install"])).result).toEqual({ args: ["install"], scriptsRan: all, exitCode: 0 });

    const manifest = await file(ctx.packageJson).json();
    manifest.dependencies["a-dep"] = "1.0.1";
    await writeFile(ctx.packageJson, JSON.stringify(manifest));

    const args = ["install", "--frozen-lockfile", "--dry-run"];
    const { err, result } = await run(args);
    expect(err).toContain("lockfile had changes, but lockfile is frozen");
    expect(result).toEqual({ args, scriptsRan: none, exitCode: 1 });
  });

  test("a root script that fails does not fail a dry run", async () => {
    using ctx = await setupTest();
    const run = await writeProject(ctx, "exit 3");

    const dryRun = await run(["install", "--dry-run"]);
    expect(dryRun.err).not.toContain("error:");
    expect(dryRun.result).toEqual({ args: ["install", "--dry-run"], scriptsRan: none, exitCode: 0 });

    const install = await run(["install"]);
    expect(install.err).toContain('error: preinstall script from "foo" exited with 3');
    expect(install.result).toEqual({ args: ["install"], scriptsRan: none, exitCode: 3 });
  });

  test("an install that is not a dry run still runs all of them", async () => {
    using ctx = await setupTest();
    const run = await writeProject(ctx);

    for (const [args, env] of [
      [["install"], {}],
      [["install", "--no-save"], {}],
      [["install", "--frozen-lockfile"], {}],
      [["install", "--production"], {}],
      [["ci"], {}],
      [["install"], { BUN_CONFIG_SKIP_INSTALL_PACKAGES: "1" }],
    ] as [string[], Record<string, string>][]) {
      const { err, result } = await run(args, env);
      expect(err).not.toContain("error:");
      expect({ ...result, env }).toEqual({ args, scriptsRan: all, exitCode: 0, env });
    }
  });
});

// `files` go beside the package.json. The tarball is not sent before `hold` resolves.
type ScriptPackage = { files?: Record<string, string>; hold?: Promise<unknown>; [field: string]: unknown };

// A project whose registry serves `packages`, each as version 1.0.0.
async function setupScriptPackages(linker: "hoisted" | "isolated", packages: Record<string, ScriptPackage>) {
  const served = new Map<string, { manifest: object; tgz: Uint8Array; hold?: Promise<unknown> }>();
  for (const [name, { files, hold, ...fields }] of Object.entries(packages)) {
    const manifest = { name, version: "1.0.0", hasInstallScript: "scripts" in fields, ...fields };
    const entries: Record<string, string> = { "package/package.json": JSON.stringify(manifest) };
    for (const [path, contents] of Object.entries(files ?? {})) entries[`package/${path}`] = contents;
    served.set(name, { manifest, hold, tgz: await new Bun.Archive(entries, { compress: "gzip" }).bytes() });
  }
  const ctx = await setupTest();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const pkg = served.get(pathname.slice(1).replace(/-1\.0\.0\.tgz$/, ""));
      if (!pkg) return new Response("not found", { status: 404 });
      if (pathname.endsWith(".tgz")) {
        await pkg.hold;
        return new Response(pkg.tgz);
      }
      return Response.json({
        ...pkg.manifest,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { ...pkg.manifest, dist: { tarball: `${origin}${pathname}-1.0.0.tgz` } } },
      });
    },
  });
  await writeFile(join(ctx.packageDir, "bunfig.toml"), `[install]\nregistry = "${server.url}"\nlinker = "${linker}"\n`);
  return {
    ...ctx,
    registry: server.url.href,
    installed: (...path: string[]) => join(ctx.packageDir, "node_modules", ...path),
    async bun(...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: ctx.packageDir,
        env: ctx.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out, err, exitCode };
    },
    [Symbol.dispose]() {
      server.stop(true);
      ctx[Symbol.dispose]();
    },
  };
}

// Writes `build.node` into the package that `node-gyp rebuild` runs in.
const fakeNodeGyp: ScriptPackage = {
  bin: { "node-gyp": "node-gyp.js" },
  files: { "node-gyp.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("build.node", "built");\n` },
};

// `dist` doesn't exist yet when the packages are linked. The root's script lists what it finds.
describe.concurrent.each(["hoisted", "isolated"] as const)("a bin whose file a script writes (%s)", linker => {
  const build = "mkdir dist && cp cli.js dist/tool";
  const files = { "cli.js": "#!/usr/bin/env node\n" };
  const names = isWindows ? ["tool.bunx", "tool.exe"] : ["tool"];

  async function expectLinked(ctx: Awaited<ReturnType<typeof setupScriptPackages>>, manifest: object) {
    await writeFile(
      ctx.packageJson,
      JSON.stringify({ name: "root", scripts: { postinstall: "ls node_modules/.bin > bins.txt" }, ...manifest }),
    );
    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect({
      bins: await readdirSorted(ctx.installed(".bin")),
      seenByRoot: readFileSync(join(ctx.packageDir, "bins.txt"), "utf8").split(/\r?\n/).filter(Boolean).sort(),
    }).toEqual({ bins: names, seenByRoot: names });
    expect(exitCode).toBe(0);
  }

  test.each([
    { form: "bin", hook: "preinstall", bin: { bin: { tool: "dist/tool" } } },
    { form: "bin", hook: "postinstall", bin: { bin: { tool: "dist/tool" } } },
    { form: "bin", hook: "prepare", bin: { bin: { tool: "dist/tool" } } },
    { form: "directories.bin", hook: "postinstall", bin: { directories: { bin: "dist" } } },
  ])("a member's $form, written by its $hook", async ({ hook, bin }) => {
    using ctx = await setupScriptPackages(linker, {});
    await mkdir(join(ctx.packageDir, "packages", "tool"), { recursive: true });
    await writeFile(join(ctx.packageDir, "packages", "tool", "cli.js"), files["cli.js"]);
    await writeFile(
      join(ctx.packageDir, "packages", "tool", "package.json"),
      JSON.stringify({ name: "tool", version: "1.0.0", ...bin, scripts: { [hook]: build } }),
    );
    await expectLinked(ctx, { workspaces: ["packages/*"], dependencies: { tool: "workspace:*" } });
  });

  test("a trusted package's bin, written by its postinstall", async () => {
    using ctx = await setupScriptPackages(linker, {
      tool: { bin: { tool: "dist/tool" }, scripts: { postinstall: build }, files },
    });
    await expectLinked(ctx, { dependencies: { tool: "1.0.0" }, trustedDependencies: ["tool"] });
  });

  test("the first package to link a bin name keeps it", async () => {
    using ctx = await setupScriptPackages(linker, {
      "a-tool": { bin: { tool: "cli.js" }, files },
      tool: { bin: { tool: "dist/tool" }, scripts: { postinstall: build }, files },
    });
    await expectLinked(ctx, { dependencies: { "a-tool": "1.0.0", tool: "1.0.0" }, trustedDependencies: ["tool"] });
    if (!isWindows) expect(readlinkSync(ctx.installed(".bin", "tool"))).toBe(join("..", "a-tool", "cli.js"));
  });

  // The file of the bin is in the tarball, so nothing is left to link after the script.
  test.skipIf(isWindows || linker === "isolated")(
    "a program that a script writes in place of its link is kept",
    async () => {
      using ctx = await setupScriptPackages(linker, {
        tool: { bin: { tool: "cli.js" }, scripts: { postinstall: "rm ../.bin/tool && cp cli.js ../.bin/tool" }, files },
      });
      await expectLinked(ctx, { dependencies: { tool: "1.0.0" }, trustedDependencies: ["tool"] });
      expect(lstatSync(ctx.installed(".bin", "tool")).isFile()).toBe(true);
    },
  );
});

describe.concurrent.each(["hoisted", "isolated"] as const)("a script that runs its dependency's bin (%s)", linker => {
  // Its `build-helper` writes `owner` into the directory that it runs in.
  const helper = (owner: string): ScriptPackage => ({
    bin: { "build-helper": "cli.js" },
    files: { "cli.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("built-by.txt", "${owner}");\n` },
  });
  const usesHelper = (dependency: string): ScriptPackage => ({
    dependencies: { [dependency]: "1.0.0" },
    scripts: { install: "build-helper" },
  });
  const builtBy = (...dir: string[]) => readFileSync(join(...dir, "built-by.txt"), "utf8");

  // One name sorts before `build-helper` and one after it.
  describe.each(["a-stranger", "z-stranger"])("%s, a dependency of the project, has the same bin", stranger => {
    const packages = {
      "build-helper": helper("build-helper"),
      native: usesHelper("build-helper"),
      [stranger]: helper(stranger),
    };
    const dependencies = { native: "1.0.0", [stranger]: "1.0.0" };

    test("bun install", async () => {
      using ctx = await setupScriptPackages(linker, packages);
      await writeFile(
        ctx.packageJson,
        JSON.stringify({
          name: "root",
          dependencies,
          trustedDependencies: ["native"],
          scripts: { postinstall: "build-helper" },
        }),
      );

      for (const lockfile of [false, true]) {
        expect(existsSync(join(ctx.packageDir, "bun.lock"))).toBe(lockfile);
        const { err, exitCode } = await ctx.bun("install");
        expect(err).not.toContain("error:");
        expect({ native: builtBy(ctx.installed("native")), project: builtBy(ctx.packageDir) }).toEqual({
          native: "build-helper",
          project: stranger,
        });
        expect(exitCode).toBe(0);
        await rm(ctx.installed(), { recursive: true, force: true });
        await rm(join(ctx.packageDir, "built-by.txt"));
      }
    });

    test("bun pm trust", async () => {
      using ctx = await setupScriptPackages(linker, packages);
      await writeFile(ctx.packageJson, JSON.stringify({ name: "root", dependencies }));

      const install = await ctx.bun("install");
      expect(install.err).not.toContain("error:");
      expect(existsSync(ctx.installed("native", "built-by.txt"))).toBe(false);
      expect(install.exitCode).toBe(0);

      const { err, exitCode } = await ctx.bun("pm", "trust", "native");
      expect(err).not.toContain("error:");
      expect(builtBy(ctx.installed("native"))).toBe("build-helper");
      expect(exitCode).toBe(0);
    });
  });

  test("two packages whose dependencies have a bin of the same name", async () => {
    using ctx = await setupScriptPackages(linker, {
      "helper-a": helper("helper-a"),
      "helper-b": helper("helper-b"),
      "native-a": usesHelper("helper-a"),
      "native-b": usesHelper("helper-b"),
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "root",
        dependencies: { "native-a": "1.0.0", "native-b": "1.0.0" },
        trustedDependencies: ["native-a", "native-b"],
      }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect({ a: builtBy(ctx.installed("native-a")), b: builtBy(ctx.installed("native-b")) }).toEqual({
      a: "helper-a",
      b: "helper-b",
    });
    expect(exitCode).toBe(0);
  });

  test("two dependencies that have a bin of the same name: the first by name", async () => {
    using ctx = await setupScriptPackages(linker, {
      "a-helper": helper("a-helper"),
      "z-helper": helper("z-helper"),
      native: {
        dependencies: { "z-helper": "1.0.0" },
        optionalDependencies: { "a-helper": "1.0.0" },
        scripts: { install: "build-helper" },
      },
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({ name: "root", dependencies: { native: "1.0.0" }, trustedDependencies: ["native"] }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(builtBy(ctx.installed("native"))).toBe("a-helper");
    expect(exitCode).toBe(0);
  });

  // The project has another `native`, so the member's is not hoisted. The hoisted linker reaches the
  // member's `node_modules` through the link `node_modules/member`.
  test("the package is in the node_modules of a workspace member", async () => {
    using ctx = await setupScriptPackages(linker, {
      "build-helper": helper("build-helper"),
      native: usesHelper("build-helper"),
      other: {},
      "a-stranger": helper("a-stranger"),
    });
    const member = join(ctx.packageDir, "packages", "member");
    await mkdir(member, { recursive: true });
    await writeFile(
      join(member, "package.json"),
      JSON.stringify({ name: "member", dependencies: { native: `${ctx.registry}native-1.0.0.tgz` } }),
    );
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { native: "npm:other@1.0.0", "a-stranger": "1.0.0" },
        trustedDependencies: ["native"],
      }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(builtBy(member, "node_modules", "native")).toBe("build-helper");
    expect(exitCode).toBe(0);
  });

  test("a link in place of the package's own node_modules is not followed", async () => {
    using ctx = await setupScriptPackages(linker, {
      "build-helper": helper("build-helper"),
      native: usesHelper("build-helper"),
    });
    await writeFile(ctx.packageJson, JSON.stringify({ name: "root", dependencies: { native: "1.0.0" } }));
    const install = await ctx.bun("install");
    expect(install.err).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    const outside = join(ctx.packageDir, "outside");
    await mkdir(outside);
    await symlink(outside, ctx.installed("native", "node_modules"), "junction");

    const { err, exitCode } = await ctx.bun("pm", "trust", "native");
    expect(err).not.toContain("error:");
    expect({ builtBy: builtBy(ctx.installed("native")), outside: await readdirSorted(outside) }).toEqual({
      builtBy: "build-helper",
      outside: [],
    });
    expect(exitCode).toBe(0);
  });

  // Only the hoisted linker links into `node_modules/native/node_modules`.
  describe.skipIf(linker === "isolated")("the package's own .bin", () => {
    const ownBin = (...native: string[]) => readdirSorted(join(...native, "node_modules", ".bin"));
    const links = isWindows ? ["build-helper.bunx", "build-helper.exe"] : ["build-helper"];
    const errors = (err: string) => splitErrLines(err).filter(line => line.startsWith("error:"));

    // `helper-alias` in the member's `node_modules` is the same package as `build-helper` in the project's.
    test("leads to the dependency by its name, not to a closer copy under another name", async () => {
      using ctx = await setupScriptPackages(linker, {
        "build-helper": helper("build-helper"),
        native: usesHelper("build-helper"),
        other: {},
      });
      const member = join(ctx.packageDir, "packages", "member");
      await mkdir(member, { recursive: true });
      await writeFile(
        join(member, "package.json"),
        JSON.stringify({
          name: "member",
          dependencies: { native: `${ctx.registry}native-1.0.0.tgz`, "helper-alias": "npm:build-helper@1.0.0" },
        }),
      );
      await writeFile(
        ctx.packageJson,
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { native: "npm:other@1.0.0", "helper-alias": "npm:other@1.0.0" },
          trustedDependencies: ["native"],
        }),
      );

      const { err, exitCode } = await ctx.bun("install");
      expect(err).not.toContain("error:");
      expect({
        closer: await readdirSorted(join(member, "node_modules")),
        ownBin: await ownBin(member, "node_modules", "native"),
      }).toEqual({ closer: [".bin", "helper-alias", "native"], ownBin: links });
      expect(exitCode).toBe(0);
    });

    // A file is in the place of `node_modules/native/node_modules`.
    async function setupBlockedBin(group: "dependencies" | "optionalDependencies") {
      const ctx = await setupScriptPackages(linker, {
        "build-helper": helper("build-helper"),
        native: usesHelper("build-helper"),
      });
      await writeFile(ctx.packageJson, JSON.stringify({ name: "root", [group]: { native: "1.0.0" } }));
      const { err, exitCode } = await ctx.bun("install");
      expect({ errors: errors(err), exitCode }).toEqual({ errors: [], exitCode: 0 });
      await writeFile(ctx.installed("native", "node_modules"), "");
      return ctx;
    }

    test.each([
      { group: "dependencies", failure: ["error: failed to link bins for life-cycle scripts for native"], exitCode: 1 },
      { group: "optionalDependencies", failure: [], exitCode: 0 },
    ] as const)("cannot be made ($group): the next install runs the scripts", async ({ group, failure, exitCode }) => {
      using ctx = await setupBlockedBin(group);
      await writeFile(
        ctx.packageJson,
        JSON.stringify({ name: "root", [group]: { native: "1.0.0" }, trustedDependencies: ["native"] }),
      );

      const first = await ctx.bun("install");
      expect({
        errors: errors(first.err).map(line => line.replace(/: E[A-Z]+$/, "")),
        installed: existsSync(ctx.installed("native")),
        exitCode: first.exitCode,
      }).toEqual({ errors: [...failure], installed: false, exitCode });

      const second = await ctx.bun("install");
      expect({
        errors: errors(second.err),
        builtBy: builtBy(ctx.installed("native")),
        ownBin: await ownBin(ctx.installed("native")),
        exitCode: second.exitCode,
      }).toEqual({ errors: [], builtBy: "build-helper", ownBin: links, exitCode: 0 });
    });

    test("cannot be made: bun pm trust runs and records nothing", async () => {
      using ctx = await setupBlockedBin("dependencies");

      const { err, exitCode } = await ctx.bun("pm", "trust", "native");
      expect({
        errors: splitErrLines(err)
          .filter(line => line.includes("failed to link"))
          .map(line => line.replace(/^E[A-Z]+: /, "")),
        ran: existsSync(ctx.installed("native", "built-by.txt")),
        manifest: await file(ctx.packageJson).json(),
        exitCode,
      }).toEqual({
        errors: ["failed to link bins for the scripts of native"],
        ran: false,
        manifest: { name: "root", dependencies: { native: "1.0.0" } },
        exitCode: 1,
      });
    });
  });

  // The hoisted linker leaves the `node_modules` of a member alone when it places nothing there.
  test("nothing is linked into a workspace member", async () => {
    using ctx = await setupScriptPackages(linker, { "build-helper": helper("build-helper") });
    const member = join(ctx.packageDir, "packages", "member");
    await mkdir(member, { recursive: true });
    await writeFile(join(member, "package.json"), JSON.stringify({ name: "member", ...usesHelper("build-helper") }));
    await writeFile(ctx.packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] }));

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect({ builtBy: builtBy(member), ownNodeModules: existsSync(join(member, "node_modules")) }).toEqual({
      builtBy: "build-helper",
      ownNodeModules: linker === "isolated",
    });
    expect(exitCode).toBe(0);
  });

  test.each([
    {
      title: "has the file of the bin",
      files: helper("build-helper-platform").files,
      owner: "build-helper-platform",
    },
    { title: "does not have the file of the bin", files: {}, owner: "build-helper" },
  ])("the dependency is in nativeDependencies and its platform package $title", async ({ files, owner }) => {
    using ctx = await setupScriptPackages(linker, {
      "build-helper": { ...helper("build-helper"), optionalDependencies: { "build-helper-platform": "1.0.0" } },
      "build-helper-platform": { os: [process.platform], cpu: [process.arch], files },
      native: usesHelper("build-helper"),
      "a-stranger": helper("a-stranger"),
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "root",
        dependencies: { native: "1.0.0", "a-stranger": "1.0.0" },
        trustedDependencies: ["native"],
        nativeDependencies: ["build-helper"],
      }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(builtBy(ctx.installed("native"))).toBe(owner);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("bun add --trust (%s)", linker => {
  // The isolated linker decides on its task threads whether a package is trusted. Under ASAN
  // this is also the shape that caught those threads growing the trusted set they read.
  test("runs and records every named package next to packages that stay untrusted", async () => {
    const trusted = Array.from({ length: 80 }, (_, i) => `trusted-${i}`).sort();
    const plain = Array.from({ length: 160 }, (_, i) => `plain-${i}`);
    using ctx = await setupScriptPackages(linker, {
      ...Object.fromEntries(trusted.map(name => [name, { scripts: { postinstall: "echo ran > ran.txt" } }])),
      ...Object.fromEntries(plain.map(name => [name, {}])),
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: Object.fromEntries(plain.map(name => [name, "1.0.0"])),
        trustedDependencies: ["zzz"],
      }),
    );

    const { err, exitCode } = await ctx.bun("add", "--trust", ...trusted);
    expect(err).not.toContain("error:");
    expect(trusted.filter(name => !existsSync(ctx.installed(name, "ran.txt")))).toEqual([]);
    expect((await file(ctx.packageJson).json()).trustedDependencies).toEqual([...trusted, "zzz"]);
    const lockfile = await file(join(ctx.packageDir, "bun.lock")).text();
    // bun.lock keeps the names that a package of the project has.
    expect(Bun.JSONC.parse(lockfile).trustedDependencies.sort()).toEqual(trusted);
    expect(exitCode).toBe(0);
  });

  // A tarball's scripts are known before it is linked, unlike those of a registry package.
  test.each([
    { gypfile: undefined, nodeGyp: true },
    { gypfile: false, nodeGyp: false },
  ])(
    "a tarball that has binding.gyp and only a postinstall (node-gyp rebuild: $nodeGyp)",
    async ({ gypfile, nodeGyp }) => {
      using ctx = await setupScriptPackages(linker, {
        "node-gyp": fakeNodeGyp,
        native: {
          gypfile,
          dependencies: { "node-gyp": "1.0.0" },
          scripts: { postinstall: "echo ran > ran.txt" },
          files: { "binding.gyp": "" },
        },
      });
      await writeFile(ctx.packageJson, JSON.stringify({ name: "foo" }));

      const { err, exitCode } = await ctx.bun("add", "--trust", `${ctx.registry}native-1.0.0.tgz`);
      expect(err).not.toContain("error:");
      expect({
        nodeGyp: existsSync(ctx.installed("native", "build.node")),
        postinstall: existsSync(ctx.installed("native", "ran.txt")),
      }).toEqual({ nodeGyp, postinstall: true });
      expect((await file(ctx.packageJson).json()).trustedDependencies).toEqual(["native"]);
      expect(exitCode).toBe(0);
    },
  );
});

describe.concurrent.each(["hoisted", "isolated"] as const)("a git dependency of another package (%s)", linker => {
  /** A repository with the package `addon`, whose postinstall script adds a line to $SCRIPT_RUNS. */
  function addonRepo(fields: object = {}) {
    const repo = tempDir("lifecycle-git-addon", {
      "package.json": JSON.stringify({
        name: "addon",
        version: "1.0.0",
        scripts: { postinstall: `echo addon >> "$SCRIPT_RUNS"` },
        ...fields,
      }),
    });
    for (const git of [
      ["init", "--quiet"],
      ["add", "."],
      ["commit", "--quiet", "-m", "init"],
    ]) {
      const config = ["commit.gpgsign=false", "user.name=Test", "user.email=test@example.com"].flatMap(c => ["-c", c]);
      expect(Bun.spawnSync({ cmd: ["git", ...config, ...git], cwd: String(repo), env: baseEnv }).exitCode).toBe(0);
    }
    return repo;
  }

  test("bun add --trust host also runs and records its dependencies", async () => {
    using repo = addonRepo({ dependencies: { leaf: "1.0.0" } });
    using ctx = await setupScriptPackages(linker, {
      host: { dependencies: { addon: `git+${pathToFileURL(String(repo)).href}` } },
      leaf: { scripts: { postinstall: `echo leaf >> "$SCRIPT_RUNS"` } },
    });
    ctx.env.SCRIPT_RUNS = join(ctx.packageDir, "runs.txt");
    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo" }));

    const { exitCode } = await ctx.bun("add", "--trust", "host");
    expect({
      ran: readFileSync(ctx.env.SCRIPT_RUNS, "utf8").trim(),
      trustedDependencies: (await file(ctx.packageJson).json()).trustedDependencies,
      exitCode,
    }).toEqual({ ran: "leaf", trustedDependencies: ["leaf"], exitCode: 0 });
  });

  test.each([
    ["pm", "trust", "addon"],
    ["pm", "trust", "--all"],
    ["add", "--trust", "host"],
  ])("is not run by bun %s %s %s", async (...args) => {
    using repo = addonRepo();
    using ctx = await setupScriptPackages(linker, {
      host: { dependencies: { addon: `git+${pathToFileURL(String(repo)).href}` } },
    });
    ctx.env.SCRIPT_RUNS = join(ctx.packageDir, "runs.txt");
    const added = args[0] === "add";
    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo", dependencies: added ? {} : { host: "1.0.0" } }));
    if (!added) {
      expect((await ctx.bun("install")).exitCode).toBe(0);
      expect((await ctx.bun("pm", "untrusted")).out).toContain("cannot trust by name");
    }

    const { exitCode } = await ctx.bun(...args);
    expect({
      ran: existsSync(ctx.env.SCRIPT_RUNS),
      trustedDependencies: (await file(ctx.packageJson).json()).trustedDependencies,
      exitCode,
    }).toEqual({ ran: false, trustedDependencies: undefined, exitCode: added ? 0 : 1 });
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)(
  "a folder inside the package that declares it (%s)",
  linker => {
    const scripted = (id: string) =>
      JSON.stringify({ name: "x", version: "1.0.0", scripts: { postinstall: `echo ${id} >> "$SCRIPT_RUNS"` } });

    async function setup(trustedDependencies?: string[]) {
      const ctx = await setupScriptPackages(linker, {
        host: { dependencies: { x: "file:x" }, files: { "x/package.json": scripted("inside") } },
      });
      ctx.env.SCRIPT_RUNS = join(ctx.packageDir, "runs.txt");
      await write(join(ctx.packageDir, "x", "package.json"), scripted("own"));
      await writeFile(
        ctx.packageJson,
        JSON.stringify({ name: "foo", dependencies: { host: "1.0.0", x: "file:x" }, trustedDependencies }),
      );
      const runs = () =>
        existsSync(ctx.env.SCRIPT_RUNS) ? readFileSync(ctx.env.SCRIPT_RUNS, "utf8").split(/\s+/).filter(Boolean) : [];
      return Object.assign(ctx, { runs });
    }

    test("has no scripts that an install runs", async () => {
      using ctx = await setup(["x"]);
      for (const [i, args] of [["install"], ["install"], ["install", "--frozen-lockfile"], ["ci"]].entries()) {
        await rm(join(ctx.packageDir, "node_modules"), { recursive: true, force: true });
        const { err, exitCode } = await ctx.bun(...args);
        expect(err).not.toContain("error:");
        expect({ args, runs: ctx.runs() }).toEqual({ args, runs: Array(i + 1).fill("own") });
        expect(exitCode).toBe(0);
      }
    });

    test("has no scripts that bun pm trust runs", async () => {
      using ctx = await setup();
      expect((await ctx.bun("install")).exitCode).toBe(0);
      const { out, err, exitCode } = await ctx.bun("pm", "trust", "x");
      expect(err).not.toContain("error:");
      expect(out).toContain("1 script ran across 1 package");
      expect(ctx.runs()).toEqual(["own"]);
      expect(exitCode).toBe(0);
    });
  },
);

// Bun skips the install scripts of sharp from 0.33.0 on, which gets its binary from `@img/sharp-*` packages.
describe.concurrent.each(["hoisted", "isolated"] as const)("scripts that bun skips by itself (%s)", linker => {
  const sharp = { scripts: { install: "echo ran > ran.txt" } };

  test.each([
    { from: "the registry", spec: () => "1.0.0", ran: false },
    { from: "a tarball", spec: (registry: string) => `${registry}sharp-1.0.0.tgz`, ran: true },
    { from: "a folder", spec: () => "file:./fork", ran: true },
    { from: "a workspace", spec: () => "workspace:*", ran: true },
  ])("sharp from $from (runs: $ran)", async ({ from, spec, ran }) => {
    using ctx = await setupScriptPackages(linker, { sharp });
    await write(
      join(ctx.packageDir, "fork", "package.json"),
      JSON.stringify({ name: "sharp", version: "1.0.0", ...sharp }),
    );
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        workspaces: from === "a workspace" ? ["fork"] : undefined,
        dependencies: { sharp: spec(ctx.registry) },
        trustedDependencies: ["sharp"],
      }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(existsSync(ctx.installed("sharp", "ran.txt"))).toBe(ran);
    expect(exitCode).toBe(0);
  });

  test.each([
    { list: "no list", ignoreScripts: undefined, ran: ["plain"] },
    { list: "an empty list", ignoreScripts: [], ran: ["plain", "sharp"] },
    { list: "another name", ignoreScripts: ["other"], ran: ["plain", "sharp"] },
    { list: "a dependency", ignoreScripts: ["plain"], ran: ["sharp"] },
  ])("an ignoreScripts list in package.json replaces them: $list", async ({ ignoreScripts, ran }) => {
    using ctx = await setupScriptPackages(linker, { sharp, plain: sharp });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: { sharp: "1.0.0", plain: "1.0.0" },
        trustedDependencies: ["sharp", "plain"],
        ignoreScripts,
      }),
    );

    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(["plain", "sharp"].filter(name => existsSync(ctx.installed(name, "ran.txt")))).toEqual(ran);
    expect(exitCode).toBe(0);
  });
});

// A package with a binding.gyp and neither an `install` nor a `preinstall` script gets
// `node-gyp rebuild` as its install script, unless its package.json says `"gypfile": false`.
describe.concurrent.each(["hoisted", "isolated"] as const)("default node-gyp script (%s)", linker => {
  // The scripts of a registry package are read once it is linked, the others' when they are resolved.
  const sources = ["registry", "tarball", "folder"] as const;
  const rows = sources.flatMap(source =>
    [undefined, false].flatMap(gypfile =>
      [undefined, { postinstall: "echo ran > ran.txt" }].map(scripts => ({
        source,
        gypfile,
        scripts,
        title: `${source}, gypfile: ${gypfile}, ${scripts ? "a postinstall" : "no scripts"}`,
        total: Number(gypfile !== false) + Number(scripts !== undefined),
      })),
    ),
  );

  async function setup({ source, gypfile, scripts }: (typeof rows)[number], trustedDependencies: string[]) {
    const native = { gypfile, scripts, hasInstallScript: true, dependencies: { "node-gyp": "1.0.0" } };
    const ctx = await setupScriptPackages(linker, {
      "node-gyp": fakeNodeGyp,
      native: { ...native, files: { "binding.gyp": "" } },
    });
    if (source === "folder") {
      await mkdir(join(ctx.packageDir, "native"));
      await Promise.all([
        writeFile(join(ctx.packageDir, "native", "package.json"), JSON.stringify({ name: "native", ...native })),
        writeFile(join(ctx.packageDir, "native", "binding.gyp"), ""),
      ]);
    }
    const spec = { registry: "1.0.0", tarball: `${ctx.registry}native-1.0.0.tgz`, folder: "file:./native" }[source];
    await writeFile(
      ctx.packageJson,
      JSON.stringify({ name: "foo", dependencies: { native: spec }, trustedDependencies }),
    );
    return ctx;
  }

  test.each(rows)("trusted: $title", async row => {
    using ctx = await setup(row, ["native"]);
    const { out, err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(out).not.toContain("Blocked");
    expect({
      nodeGyp: existsSync(ctx.installed("native", "build.node")),
      postinstall: existsSync(ctx.installed("native", "ran.txt")),
    }).toEqual({ nodeGyp: row.gypfile !== false, postinstall: row.scripts !== undefined });
    expect(exitCode).toBe(0);
  });

  test.each(rows)("blocked: $title", async row => {
    using ctx = await setup(row, []);
    const { out, err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect(out.match(/Blocked \d+ postinstalls?/)?.[0]).toBe(
      [undefined, "Blocked 1 postinstall", "Blocked 2 postinstalls"][row.total],
    );
    expect(exitCode).toBe(0);

    if (row.gypfile === false) {
      const untrusted = await ctx.bun("pm", "untrusted");
      expect(untrusted.out).not.toContain("node-gyp rebuild");
      expect(untrusted.exitCode).toBe(0);
    }
  });

  test.each(rows.filter(({ source }) => source === "folder"))("the project itself: $title", async row => {
    using ctx = await setupScriptPackages(linker, { "node-gyp": fakeNodeGyp });
    await Promise.all([
      writeFile(join(ctx.packageDir, "binding.gyp"), ""),
      writeFile(
        ctx.packageJson,
        JSON.stringify({
          name: "foo",
          gypfile: row.gypfile,
          scripts: row.scripts,
          dependencies: { "node-gyp": "1.0.0" },
        }),
      ),
    ]);
    const { err, exitCode } = await ctx.bun("install");
    expect(err).not.toContain("error:");
    expect({
      nodeGyp: existsSync(join(ctx.packageDir, "build.node")),
      postinstall: existsSync(join(ctx.packageDir, "ran.txt")),
    }).toEqual({ nodeGyp: row.gypfile !== false, postinstall: row.scripts !== undefined });
    expect(exitCode).toBe(0);
  });
});

// Each script reports that it's running and then stays alive until the test writes a line into its pipe. So the number
// of scripts that run at once is counted, not timed.
describe.concurrent.each(["hoisted", "isolated"] as const)("scripts that run at the same time (%s)", linker => {
  const names = ["a", "b", "c", "d"];

  test.skipIf(isWindows).each([
    { title: "--concurrent-scripts=1", bunfig: "", args: ["--concurrent-scripts=1"], limit: 1 },
    { title: "--concurrent-scripts=2", bunfig: "", args: ["--concurrent-scripts=2"], limit: 2 },
    { title: "concurrentScripts = 1", bunfig: "concurrentScripts = 1\n", args: [], limit: 1 },
    {
      title: "--concurrent-scripts=3 over concurrentScripts = 1",
      bunfig: "concurrentScripts = 1\n",
      args: ["--concurrent-scripts=3"],
      limit: 3,
    },
    // The default is twice the number of threads, which is at least 2.
    { title: "--concurrent-scripts=0 is the default", bunfig: "", args: ["--concurrent-scripts=0"], limit: 4 },
    {
      title: "--concurrent-scripts=0 leaves concurrentScripts = 1",
      bunfig: "concurrentScripts = 1\n",
      args: ["--concurrent-scripts=0"],
      limit: 1,
    },
  ])(
    "$title",
    async ({ bunfig, args, limit }) => {
      const late = Promise.withResolvers<void>();
      // The hoisted linker starts no script before every package of the project is in place.
      if (linker === "hoisted") late.resolve();
      using ctx = await setupScriptPackages(linker, {
        ...Object.fromEntries(
          names.map(name => [
            name,
            { scripts: { postinstall: `echo ${name} >> "$STARTED" && read line < "$GATES/${name}"` } },
          ]),
        ),
        late: { hold: late.promise },
      });
      await appendFile(join(ctx.packageDir, "bunfig.toml"), bunfig);
      await writeFile(
        ctx.packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: Object.fromEntries([...names, "late"].map(name => [name, "1.0.0"])),
          trustedDependencies: names,
        }),
      );
      // With a lockfile, the linker downloads what it links. Without one, everything is downloaded before it starts.
      expect((await ctx.bun("install", "--lockfile-only")).exitCode).toBe(0);

      const gates = join(ctx.packageDir, "gates");
      await mkdir(gates);
      expect(Bun.spawnSync({ cmd: ["mkfifo", ...names.map(name => join(gates, name))] }).exitCode).toBe(0);
      // Also opened for reading, so that a line written before the script opens its end stays in the pipe.
      const pipes = new Map(
        names.map(name => [name, openSync(join(gates, name), fsConstants.O_RDWR | fsConstants.O_NONBLOCK)]),
      );
      const log = join(ctx.packageDir, "started.txt");
      const started = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: ctx.packageDir,
        env: { ...ctx.env, STARTED: log, GATES: gates },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const until = async (condition: () => boolean) => {
        while (!condition()) {
          if (proc.exitCode !== null) throw new Error(`bun install exited with ${proc.exitCode}`);
          await Bun.sleep(1);
        }
      };
      try {
        for (let done = 0; done < names.length; done += limit) {
          const expected = Math.min(names.length, done + limit);
          await until(() => started().length >= expected);
          // Downloading, extracting and linking one more package gives a linker without a limit
          // all the time it needs to start the other scripts.
          late.resolve();
          await until(() => existsSync(ctx.installed("late", "package.json")));
          expect(started()).toHaveLength(expected);
          for (const name of started().slice(done)) writeSync(pipes.get(name)!, "\n");
        }
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(err).not.toContain("error:");
        expect(started().sort()).toEqual(names);
        expect(exitCode).toBe(0);
      } finally {
        // A script that is still there ends: it finds no pipe to open, or a line in the one it has open.
        rmSync(gates, { recursive: true, force: true });
        for (const pipe of pipes.values()) {
          writeSync(pipe, "\n");
          closeSync(pipe);
        }
      }
    },
    30_000,
  );

  test.skipIf(isWindows)(
    "a script that ends makes room for the next one while another keeps running",
    async () => {
      using ctx = await setupScriptPackages(
        linker,
        Object.fromEntries(
          names.map(name => [
            name,
            { scripts: { postinstall: `echo ${name} >> "$STARTED" && read line < "$GATES/${name}"` } },
          ]),
        ),
      );
      await writeFile(
        ctx.packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
          trustedDependencies: names,
        }),
      );
      expect((await ctx.bun("install", "--lockfile-only")).exitCode).toBe(0);

      const gates = join(ctx.packageDir, "gates");
      await mkdir(gates);
      expect(Bun.spawnSync({ cmd: ["mkfifo", ...names.map(name => join(gates, name))] }).exitCode).toBe(0);
      const pipes = new Map(
        names.map(name => [name, openSync(join(gates, name), fsConstants.O_RDWR | fsConstants.O_NONBLOCK)]),
      );
      const log = join(ctx.packageDir, "started.txt");
      const started = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

      await using proc = spawn({
        cmd: [bunExe(), "install", "--concurrent-scripts=2"],
        cwd: ctx.packageDir,
        env: { ...ctx.env, STARTED: log, GATES: gates },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        // The first one keeps running to the end, so each of the others has to start while it runs.
        for (let count = 2; count <= names.length; count++) {
          while (started().length < count) {
            if (proc.exitCode !== null) throw new Error(`bun install exited with ${proc.exitCode}`);
            await Bun.sleep(1);
          }
          expect(started()).toHaveLength(count);
          writeSync(pipes.get(started()[count - 1])!, "\n");
        }
        writeSync(pipes.get(started()[0])!, "\n");
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(err).not.toContain("error:");
        expect(exitCode).toBe(0);
      } finally {
        rmSync(gates, { recursive: true, force: true });
        for (const pipe of pipes.values()) {
          writeSync(pipe, "\n");
          closeSync(pipe);
        }
      }
    },
    10_000,
  );

  test("packages that a later install trusts, one script at a time", async () => {
    using ctx = await setupScriptPackages(
      linker,
      Object.fromEntries(
        names.map(name => [
          name,
          { scripts: { preinstall: "echo pre > pre.txt", postinstall: "echo post > post.txt" } },
        ]),
      ),
    );
    const manifest = { name: "foo", dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])) };
    await writeFile(ctx.packageJson, JSON.stringify(manifest));
    const blocked = await ctx.bun("install");
    expect(blocked.out).toContain("Blocked 8 postinstalls");
    expect(blocked.exitCode).toBe(0);

    await writeFile(ctx.packageJson, JSON.stringify({ ...manifest, trustedDependencies: names }));
    const { err, exitCode } = await ctx.bun("install", "--concurrent-scripts=1");
    expect(err).not.toContain("error:");
    expect(
      names.filter(name => existsSync(ctx.installed(name, "pre.txt")) && existsSync(ctx.installed(name, "post.txt"))),
    ).toEqual(names);
    expect(exitCode).toBe(0);
  });
});

// A failed script ends the install. The next install runs it again, and with it every script that
// the failure kept from running or from finishing.
describe.concurrent.each(["hoisted", "isolated"] as const)("the install after a failed script (%s)", linker => {
  const names = ["a", "b", "c", "needs-a"];
  // Appends its name to $RUNS, then fails once $RUNS has $FAIL_AT lines.
  const counted = (name: string) => `echo ${name} >> "$RUNS" && test $(wc -l < "$RUNS") -lt $FAIL_AT`;

  async function setup(script: "preinstall" | "install" | "postinstall") {
    const ctx = await setupScriptPackages(
      linker,
      Object.fromEntries(
        names.map(name => [
          name,
          { scripts: { [script]: counted(name) }, dependencies: name === "needs-a" ? { a: "1.0.0" } : undefined },
        ]),
      ),
    );
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
        trustedDependencies: names,
      }),
    );
    return {
      ctx,
      async install(run: string, failAt: number, ...args: string[]) {
        const runs = join(ctx.packageDir, run);
        ctx.env.RUNS = runs;
        ctx.env.FAIL_AT = String(failAt);
        const { err, exitCode } = await ctx.bun("install", ...args);
        return {
          errors: splitErrLines(err).filter(line => line.startsWith("error:")),
          ran: existsSync(runs) ? readFileSync(runs, "utf8").split("\n").filter(Boolean) : [],
          exitCode,
        };
      },
    };
  }

  // One at a time, so that the third script to start is the one that fails. Two have finished and aren't run again, and
  // one hasn't started.
  test.skipIf(isWindows).each([
    { title: "preinstall", script: "preinstall", args: [] },
    { title: "install", script: "install", args: [] },
    { title: "postinstall", script: "postinstall", args: [] },
    { title: "postinstall, --frozen-lockfile", script: "postinstall", args: ["--frozen-lockfile"] },
  ] as const)("$title: runs what did not finish, and only that", async ({ script, args }) => {
    const { ctx, install } = await setup(script);
    using _ = ctx;
    if (args.length > 0) expect((await ctx.bun("install", "--lockfile-only")).exitCode).toBe(0);

    const first = await install("first.txt", 3, "--concurrent-scripts=1", ...args);
    expect(first).toEqual({
      errors: [`error: ${script} script from "${first.ran[2]}" exited with 1`],
      ran: [expect.any(String), expect.any(String), expect.any(String)],
      exitCode: 1,
    });

    const unfinished = names.filter(name => !first.ran.slice(0, 2).includes(name));
    const second = await install("second.txt", 100, ...args);
    expect({ ...second, ran: second.ran.sort() }).toEqual({
      errors: [],
      // After a preinstall the isolated linker still links the package's bins, on another thread:
      // the package may be finished by the time of the failure or not.
      ran: linker === "isolated" && script === "preinstall" ? expect.arrayContaining(unfinished) : unfinished,
      exitCode: 0,
    });

    expect(await install("third.txt", 100, ...args)).toEqual({ errors: [], ran: [], exitCode: 0 });
  });

  test.skipIf(isWindows)("all at the same time: every script runs in the end", async () => {
    const { ctx, install } = await setup("postinstall");
    using _ = ctx;

    const first = await install("first.txt", 1);
    expect(first.exitCode).toBe(1);

    const second = await install("second.txt", 100);
    expect({ ...second, ran: second.ran.sort() }).toEqual({ errors: [], ran: names, exitCode: 0 });
  });

  // bun looks for the shell once. The first script removes it, whichever script that is and
  // however far the other packages are, so the second one has nothing to start with.
  test.skipIf(isWindows)("a script that cannot be started", async () => {
    const waiting = ["v", "w", "x", "y", "z"];
    using ctx = await setupScriptPackages(
      linker,
      Object.fromEntries(
        waiting.map(name => [
          name,
          { scripts: { postinstall: `echo ${name} >> "$RUNS" && { test -z "$SABOTAGE" || rm "$SABOTAGE"; }` } },
        ]),
      ),
    );
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: Object.fromEntries(waiting.map(name => [name, "1.0.0"])),
        trustedDependencies: waiting,
      }),
    );
    const ran = (run: string) => readFileSync(join(ctx.packageDir, run), "utf8").split("\n").filter(Boolean);
    // A link to the shell that bun would find, under its own name, in front of it in $PATH.
    const shell = ["bash", "sh", "zsh"].find(name => Bun.which(name, { PATH: ctx.env.PATH }))!;
    const link = join(ctx.packageDir, "shell", shell);
    await mkdir(join(ctx.packageDir, "shell"));
    await symlink(Bun.which(shell, { PATH: ctx.env.PATH })!, link);
    Object.assign(ctx.env, {
      PATH: `${join(ctx.packageDir, "shell")}:${ctx.env.PATH}`,
      RUNS: join(ctx.packageDir, "first.txt"),
      SABOTAGE: link,
    });

    const first = await ctx.bun("install", "--concurrent-scripts=1");
    expect(splitErrLines(first.err).filter(line => line.startsWith("error:"))).toEqual([
      "error: Failed to run script postinstall due to error ENOENT",
    ]);
    expect(ran("first.txt")).toHaveLength(1);
    expect(first.exitCode).toBe(1);
    // Packages whose scripts didn't run aren't installed either.
    const inPlace = waiting.filter(name => existsSync(ctx.installed(name, "package.json")));
    expect(inPlace.filter(name => !ran("first.txt").includes(name))).toEqual([]);

    Object.assign(ctx.env, { RUNS: join(ctx.packageDir, "second.txt"), SABOTAGE: "" });
    const second = await ctx.bun("install");
    expect(second.err).not.toContain("error:");
    expect(ran("second.txt").sort()).toEqual(waiting.filter(name => !inPlace.includes(name)));
    expect(second.exitCode).toBe(0);
  });

  // The root's `dep` is a different package. With the hoisted linker, each parent has its own copy, and the first one
  // fails before the walk reaches the last.
  test.skipIf(isWindows)("copies that the failed install hadn't reached", async () => {
    const parents = Array.from({ length: 40 }, (_, i) => `parent-${i}`);
    using ctx = await setupScriptPackages(linker, {
      scripted: { scripts: { postinstall: `echo ran >> "$RUNS" && test -z "$FAIL"` } },
      other: {},
      ...Object.fromEntries(parents.map(name => [name, { dependencies: { dep: "npm:scripted@1.0.0" } }])),
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: { dep: "npm:other@1.0.0", ...Object.fromEntries(parents.map(name => [name, "1.0.0"])) },
        trustedDependencies: ["scripted"],
      }),
    );
    // With everything in the cache an install only links.
    expect((await ctx.bun("install", "--ignore-scripts")).exitCode).toBe(0);
    await rm(join(ctx.packageDir, "node_modules"), { recursive: true });

    Object.assign(ctx.env, { RUNS: join(ctx.packageDir, "first.txt"), FAIL: "1" });
    const first = await ctx.bun("install");
    expect(splitErrLines(first.err).filter(line => line.startsWith("error:"))).toEqual([
      'error: postinstall script from "dep" exited with 1',
    ]);
    expect(first.exitCode).toBe(1);

    Object.assign(ctx.env, { RUNS: join(ctx.packageDir, "second.txt"), FAIL: "" });
    const second = await ctx.bun("install");
    expect(second.err).not.toContain("error:");
    expect(readFileSync(ctx.env.RUNS, "utf8").split("\n").filter(Boolean)).toHaveLength(
      linker === "hoisted" ? parents.length : 1,
    );
    expect(second.exitCode).toBe(0);
  });

  // The scripts of a registry package are read from the package.json that was linked.
  test("a package whose scripts cannot be read fails every install", async () => {
    using ctx = await setupScriptPackages(linker, {
      unreadable: { hasInstallScript: true, files: { "package.json": "{ not json" } },
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({ name: "foo", dependencies: { unreadable: "1.0.0" }, trustedDependencies: ["unreadable"] }),
    );
    // The first install fails on the tarball; the later ones find it in the cache and link it.
    for (let install = 0; install < 3; install++) {
      const { err, exitCode } = await ctx.bun("install");
      expect(err).toContain("ParserError");
      expect(exitCode).toBe(1);
    }
  });
});

test.concurrent("prints a failed script's output without changing non-UTF-8 bytes", async () => {
  using dir = tempDir("lifecycle-output-bytes", {
    "package.json": JSON.stringify({
      name: "app",
      dependencies: { dep: "file:./dep" },
      trustedDependencies: ["dep"],
    }),
    "dep/package.json": JSON.stringify({
      name: "dep",
      version: "1.0.0",
      scripts: { postinstall: `${bunExe()} fail.js` },
    }),
    // "café" in Latin-1, followed by two bytes that are never valid in UTF-8.
    "dep/fail.js": `process.stdout.write(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      process.stderr.write(Buffer.from([0xfe, 0xff]));
      process.exitCode = 1;`,
  });
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: baseEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.bytes(), proc.exited]);
  const hex = Buffer.from(err).toString("hex");
  expect(hex).toContain("636166e90a");
  expect(hex).toContain("feff0a");
  expect(exitCode).toBe(1);
});

// `bun x node-gyp` avoids running Bun's own node-gyp shim again by removing the PATH entry that equals
// BUN_WHICH_IGNORE_CWD.
test.concurrent.skipIf(!isLinux)(
  "BUN_WHICH_IGNORE_CWD matches a PATH entry when TMPDIR isn't valid UTF-8",
  async () => {
    using dir = tempDir("lifecycle-tmpdir-bytes", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { dep: "file:./dep" },
        trustedDependencies: ["dep"],
      }),
      "dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        scripts: { postinstall: `${bunExe()} check.js` },
      }),
      // Read as latin1 to keep every byte. `process.env` and a shell `case` on musl both mangle invalid UTF-8.
      "dep/check.js": `const fs = require("fs");
      const env = fs.readFileSync("/proc/self/environ", "latin1").split("\\0");
      const get = name => env.find(entry => entry.startsWith(name + "=")).slice(name.length + 1);
      fs.writeFileSync(process.env.RESULT, get("PATH").split(":").includes(get("BUN_WHICH_IGNORE_CWD")) ? "found" : "missing");`,
    });
    // A JavaScript string can't hold a lone 0xE9 byte, so TMPDIR is set by a shell script written as raw bytes.
    await writeFile(
      join(dir, "install.sh"),
      Buffer.concat([
        Buffer.from(`TMPDIR='${dir}/caf`),
        Buffer.from([0xe9]),
        Buffer.from(`'; export TMPDIR; mkdir -p "$TMPDIR"; exec '${bunExe()}' install\n`),
      ]),
    );
    await using proc = spawn({
      cmd: ["sh", "./install.sh"],
      cwd: String(dir),
      // Bun only uses TMPDIR if it's on the same filesystem as the cache.
      env: {
        ...baseEnv,
        BUN_TMPDIR: undefined,
        BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
        RESULT: join(dir, "result"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(readFileSync(join(dir, "result"), "utf8")).toBe("found");
    expect(exitCode).toBe(0);
  },
);

// PR_SET_PDEATHSIG. The script holds the write end of `alive`, which ends when the script does, and
// waits for a line in `gate`, which the test writes once bun is gone.
test.concurrent.skipIf(!isLinux).each(["hoisted", "isolated"] as const)(
  "a script does not outlive a bun install that is killed (%s)",
  async linker => {
    using ctx = await setupScriptPackages(linker, {
      held: {
        scripts: { postinstall: 'exec 3> "$ALIVE" && echo started >&3 && read line < "$GATE" && echo survived >&3' },
      },
    });
    await writeFile(
      ctx.packageJson,
      JSON.stringify({ name: "foo", dependencies: { held: "1.0.0" }, trustedDependencies: ["held"] }),
    );
    const [ALIVE, GATE] = [join(ctx.packageDir, "alive"), join(ctx.packageDir, "gate")];
    expect(Bun.spawnSync({ cmd: ["mkfifo", ALIVE, GATE] }).exitCode).toBe(0);
    const gate = openSync(GATE, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.packageDir,
      env: { ...ctx.env, ALIVE, GATE },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const alive = createReadStream(ALIVE, "utf8")[Symbol.asyncIterator]();
      const first = await Promise.race([alive.next(), proc.exited]);
      expect(first).toEqual({ done: false, value: "started\n" });

      proc.kill("SIGKILL");
      await proc.exited;
      writeSync(gate, "\n");
      expect(await alive.next()).toEqual({ done: true, value: undefined });
    } finally {
      // Ends a reader that still waits for a script to open the other end.
      closeSync(openSync(ALIVE, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));
      closeSync(gate);
    }
  },
);

// To run a package's scripts, bun reads its package.json and puts its `node_modules/.bin` in $PATH,
// both by their absolute paths. PATH_MAX is 4096 on Linux.
test.concurrent.skipIf(!isLinux).each([
  ["hoisted", "node_modules/scripted/package.json"],
  ["hoisted", "node_modules/scripted/node_modules/.bin"],
  ["isolated", "node_modules/.bun/scripted@1.0.0/node_modules/scripted/package.json"],
  ["isolated", "node_modules/.bun/scripted@1.0.0/node_modules/scripted/node_modules/.bin"],
] as const)("%s: a project so deep that %s exceeds PATH_MAX fails with ENAMETOOLONG", async (linker, subpath) => {
  using ctx = await setupScriptPackages(linker, { scripted: { scripts: { postinstall: "echo ran > ran.txt" } } });
  const projectBytes = 4096 + 1 - `/${subpath}`.length;
  let project = ctx.packageDir;
  // The last name has to stay under NAME_MAX (255).
  while (projectBytes - project.length > 256) project = join(project, Buffer.alloc(200, "d").toString());
  project = join(project, Buffer.alloc(projectBytes - project.length - 1, "d").toString());
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { scripted: "1.0.0" }, trustedDependencies: ["scripted"] }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install", `--linker=${linker}`],
    cwd: project,
    env: { ...ctx.env, BUN_CONFIG_REGISTRY: ctx.registry },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(err).toContain("ENAMETOOLONG");
  expect(exitCode).toBe(1);
});

// `baz` is an optional dependency of the project, and its postinstall fails. Whether the install continues without it
// depends on who else needs it, not on the dependency that the linker placed it for.
describe.concurrent.each(["hoisted", "isolated"] as const)("failed script of an optional dependency (%s)", linker => {
  const packages: Record<string, ScriptPackage> = {
    baz: { scripts: { postinstall: "exit 1" } },
    "needs-baz": { dependencies: { baz: "1.0.0" } },
    "may-use-baz": { optionalDependencies: { baz: "1.0.0" } },
    "may-share-baz": { peerDependencies: { baz: "1.0.0" }, peerDependenciesMeta: { baz: { optional: true } } },
    "shares-baz": { peerDependencies: { baz: "1.0.0" } },
  };
  const optional = { optionalDependencies: { baz: "1.0.0" }, trustedDependencies: ["baz"] };
  const shapes = [
    { title: "nothing else needs it", manifest: optional, args: [], required: false },
    {
      title: "another optional dependency",
      manifest: { ...optional, dependencies: { "may-use-baz": "1.0.0" } },
      args: [],
      required: false,
    },
    {
      title: "an optional peer dependency",
      manifest: { ...optional, dependencies: { "may-share-baz": "1.0.0" } },
      args: [],
      required: false,
    },
    {
      title: "a devDependency that --production leaves out",
      manifest: { ...optional, devDependencies: { "needs-baz": "1.0.0" } },
      args: ["--production"],
      required: false,
    },
    {
      title: "a dependency needs it",
      manifest: { ...optional, dependencies: { "needs-baz": "1.0.0" } },
      args: [],
      required: true,
    },
    {
      title: "a dependency needs it, one script at a time",
      manifest: { ...optional, dependencies: { "needs-baz": "1.0.0" } },
      args: ["--concurrent-scripts=1"],
      required: true,
    },
    {
      title: "a peer dependency needs it",
      manifest: { ...optional, dependencies: { "shares-baz": "1.0.0" } },
      args: [],
      required: true,
    },
    {
      title: "an optional dependency needs it",
      manifest: { ...optional, optionalDependencies: { baz: "1.0.0", "needs-baz": "1.0.0" } },
      args: [],
      required: true,
    },
  ];

  async function expectOutcome(
    ctx: Awaited<ReturnType<typeof setupScriptPackages>>,
    args: string[],
    required: boolean,
  ) {
    const { err, exitCode } = await ctx.bun("install", ...args);
    expect({
      errors: splitErrLines(err).filter(line => line.startsWith("error:")),
      exitCode,
    }).toEqual(
      required
        ? { errors: ['error: postinstall script from "baz" exited with 1'], exitCode: 1 }
        : { errors: [], exitCode: 0 },
    );
    if (!required) expect(existsSync(ctx.installed("baz"))).toBeFalse();
  }

  test.each(shapes)("$title", async ({ manifest, args, required }) => {
    using ctx = await setupScriptPackages(linker, packages);
    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo", ...manifest }));
    await expectOutcome(ctx, args, required);
  });

  test.each(shapes)("$title (--frozen-lockfile)", async ({ manifest, args, required }) => {
    using ctx = await setupScriptPackages(linker, packages);
    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo", ...manifest }));
    expect((await ctx.bun("install", "--lockfile-only")).exitCode).toBe(0);
    await expectOutcome(ctx, [...args, "--frozen-lockfile"], required);
  });

  // The package is installed and blocked. The second install trusts it and runs its script. `--production` is excluded,
  // because it's a frozen install, which doesn't look for newly trusted names.
  const unfrozen = shapes.filter(({ args }) => !args.includes("--production"));
  test.each(unfrozen)("$title (trusted by a later install)", async ({ manifest, args, required }) => {
    using ctx = await setupScriptPackages(linker, packages);
    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo", ...manifest, trustedDependencies: [] }));
    const blocked = await ctx.bun("install", ...args);
    expect(blocked.out).toContain("Blocked 1 postinstall");
    expect(blocked.exitCode).toBe(0);

    await writeFile(ctx.packageJson, JSON.stringify({ name: "foo", ...manifest }));
    await expectOutcome(ctx, args, required);
  });

  // `--filter` chooses what this install links, not who needs a package. The copy that would be removed may be the one
  // that an earlier install linked for the other workspace.
  test.each([
    { title: "needs it", other: { dependencies: { baz: "1.0.0" } }, required: true },
    { title: "may use it", other: { optionalDependencies: { baz: "1.0.0" } }, required: false },
  ])("a workspace that --filter leaves out $title", async ({ other, required }) => {
    using ctx = await setupScriptPackages(linker, packages);
    await Promise.all([
      writeFile(
        ctx.packageJson,
        JSON.stringify({ name: "foo", workspaces: ["packages/*"], trustedDependencies: ["baz"] }),
      ),
      write(
        join(ctx.packageDir, "packages", "selected", "package.json"),
        JSON.stringify({ name: "selected", optionalDependencies: { baz: "1.0.0" } }),
      ),
      write(join(ctx.packageDir, "packages", "other", "package.json"), JSON.stringify({ name: "other", ...other })),
    ]);
    const { err, exitCode } = await ctx.bun("install", "--filter", "selected");
    expect({
      errors: splitErrLines(err).filter(line => line.startsWith("error:")),
      exitCode,
    }).toEqual(
      required
        ? { errors: ['error: postinstall script from "baz" exited with 1'], exitCode: 1 }
        : { errors: [], exitCode: 0 },
    );
  });
});

// waiter thread is only a thing on Linux.
for (const forceWaiterThread of isLinux ? [false, true] : [false]) {
  describe.concurrent("lifecycle scripts" + (forceWaiterThread ? " (waiter thread)" : ""), async () => {
    test("root package with all lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const scriptNames = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"];
      // Every root script appends its own name to `<name>.txt`, so that file holds one line per run.
      const scripts = Object.fromEntries(scriptNames.map(name => [name, `echo ${name} >> ${name}.txt`]));
      const rootScriptFiles = (runs: number) =>
        Object.fromEntries(scriptNames.map(name => [name, `${name}\n`.repeat(runs)]));
      // Each script of `all-lifecycle-scripts` writes `<name>!` to `<name>.txt`, or `<name> exists!`
      // when the file is already there. `prepare.txt` ships in the tarball: dependencies only run
      // preinstall, install and postinstall.
      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");
      const depScriptFiles = {
        preinstall: "preinstall!",
        install: "install!",
        postinstall: "postinstall!",
        preprepare: null,
        prepare: "prepare!",
        postprepare: null,
      };

      async function scriptFiles(dir: string): Promise<Record<string, string | null>> {
        return Object.fromEntries(
          await Promise.all(
            scriptNames.map(async name => {
              const path = join(dir, `${name}.txt`);
              return [name, (await exists(path)) ? await file(path).text() : null];
            }),
          ),
        );
      }

      async function install() {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        // Root scripts run in the foreground, and bun prints each command before it runs it.
        expect(splitErrLines(err).filter(line => line.startsWith("$ "))).toEqual(
          scriptNames.map(name => `$ ${scripts[name]}`),
        );
        expect(exitCode).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
        return { out, err };
      }

      await writeFile(packageJson, JSON.stringify({ name: "foo", version: "1.0.0", scripts }));

      let { out, err } = await install();
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(normalizeBunSnapshot(out)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)
         done"
      `);
      expect(await scriptFiles(packageDir)).toEqual(rootScriptFiles(1));

      // add a dependency with all lifecycle scripts
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts,
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ out, err } = await install());
      expect(err).toContain("Saved lockfile");
      expect(normalizeBunSnapshot(out)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + all-lifecycle-scripts@1.0.0

        1 package installed"
      `);
      expect(await scriptFiles(packageDir)).toEqual(rootScriptFiles(2));
      expect(await scriptFiles(depDir)).toEqual(depScriptFiles);

      // all at once
      await Promise.all([
        ...scriptNames.map(name => rm(join(packageDir, `${name}.txt`))),
        rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
        rm(join(packageDir, "bun.lock")),
      ]);

      ({ out, err } = await install());
      expect(err).toContain("Saved lockfile");
      expect(normalizeBunSnapshot(out)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + all-lifecycle-scripts@1.0.0

        1 package installed"
      `);
      expect(await scriptFiles(packageDir)).toEqual(rootScriptFiles(1));
      expect(await scriptFiles(depDir)).toEqual(depScriptFiles);
    });

    test("workspace lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg1", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postprepare.txt"))).toBeFalse();
    });

    test("dependency lifecycle scripts run before root lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const script = '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]';
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: script,
            postinstall: script,
            preinstall: script,
            prepare: script,
            postprepare: script,
            preprepare: script,
          },
        }),
      );

      // uses-what-bin-slow will wait one second then write a file to disk. The root package should wait for
      // for this to happen before running its lifecycle scripts.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      var out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("install a dependency with lifecycle scripts, then add to trusted dependencies and install again", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      var out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        "1 package installed",
        "",
        "Blocked 3 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");
      expect(await exists(join(depDir, "preinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "install.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      // add to trusted dependencies
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("Checked 1 install across 2 packages (no changes)"),
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
    });

    test("adding a package without scripts to trustedDependencies", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      var out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      const what_bin_bins = !isWindows ? ["what-bin"] : ["what-bin.bunx", "what-bin.exe"];
      // prettier-ignore
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: { "what-bin": "1.0.0" },
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      // add it to trusted dependencies
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);
    });

    test("lifecycle scripts run if node_modules is deleted", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-postinstall"],
        }),
      );
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });
      var err = await stderr.text();
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        // @ts-ignore
        "1 package installed",
      ]);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      await rm(join(packageDir, "node_modules"), { force: true, recursive: true });
      await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));
      err = await stderr.text();
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    // https://github.com/oven-sh/bun/issues/12752
    test.each(["hoisted", "isolated"])(
      "npm_config_local_prefix and npm_package_* are set for root and dependency scripts (%s)",
      async linker => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        // Each script dumps the variables under test into env.json in its own cwd.
        const captureEnv = `
      require("fs").writeFileSync(
        "env.json",
        JSON.stringify({
          localPrefix: process.env.npm_config_local_prefix,
          package: Object.fromEntries(
            Object.entries(process.env).filter(([name]) => name.startsWith("npm_package_")),
          ),
        }),
      );
      `;

        await mkdir(join(packageDir, "dep"));
        await Promise.all([
          writeFile(
            packageJson,
            JSON.stringify({
              name: "root-project",
              version: "1.0.0",
              config: {
                port: "8080",
                shared: "from-root",
                // Like `bun run`, only non-empty top-level string values are exported.
                retries: 3,
                nested: { key: "value" },
                blank: "",
              },
              scripts: { postinstall: `${bunExe()} capture-env.js` },
              dependencies: { "my-dep": "file:./dep" },
              trustedDependencies: ["my-dep"],
            }),
          ),
          writeFile(join(packageDir, "capture-env.js"), captureEnv),
          writeFile(
            join(packageDir, "dep", "package.json"),
            JSON.stringify({
              name: "my-dep",
              version: "2.0.0",
              config: { depkey: "dep-value", shared: "from-dep" },
              scripts: { postinstall: `${bunExe()} capture-env.js` },
            }),
          ),
          writeFile(join(packageDir, "dep", "capture-env.js"), captureEnv),
        ]);

        // `bun run`/`npm run` leave their own values in the environment of the commands they
        // run (including this test under `bun run`); the install must replace them with its own.
        const installEnv: Record<string, string> = {
          ...testEnv,
          npm_config_local_prefix: "/some/other/project",
          npm_package_json: "/some/other/project/package.json",
          npm_package_name: "other-project",
          npm_package_version: "9.9.9",
          npm_package_config_other: "from-other-project",
          npm_package_config_shared: "from-other-project",
        };

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install", `--linker=${linker}`],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: installEnv,
        });

        const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
        expect(err).not.toContain("error:");
        expect(out).toContain("+ my-dep@dep");
        expect(exitCode).toBe(0);

        expect(await file(join(packageDir, "env.json")).json()).toEqual({
          localPrefix: packageDir,
          package: {
            npm_package_json: join(packageDir, "package.json"),
            npm_package_name: "root-project",
            npm_package_version: "1.0.0",
            npm_package_config_port: "8080",
            npm_package_config_shared: "from-root",
          },
        });

        // A dependency sees its own package.json, not the root's.
        const dep = realpathSync(join(packageDir, "node_modules", "my-dep"));
        expect(await file(join(dep, "env.json")).json()).toEqual({
          localPrefix: packageDir,
          package: {
            npm_package_json: join(dep, "package.json"),
            npm_package_name: "my-dep",
            npm_package_version: "2.0.0",
            npm_package_config_depkey: "dep-value",
            npm_package_config_shared: "from-dep",
          },
        });
      },
    );

    test.each(["hoisted", "isolated"])(
      "npm_lifecycle_event and npm_lifecycle_script name the script that runs (%s)",
      async linker => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        // Appends one line per script to events.txt in its cwd.
        const capture = `require("fs").appendFileSync("events.txt", process.env.npm_lifecycle_event + ": " + process.env.npm_lifecycle_script + "\\n");`;
        const script = (name: string) => `${bunExe()} capture.js ${name}`;
        const scripts = (...names: string[]) => Object.fromEntries(names.map(name => [name, script(name)]));
        const events = (...names: string[]) => names.map(name => `${name}: ${script(name)}\n`).join("");

        await mkdir(join(packageDir, "dep"));
        await Promise.all([
          writeFile(
            packageJson,
            JSON.stringify({
              name: "root-project",
              version: "1.0.0",
              scripts: scripts("preinstall", "postinstall", "prepare"),
              dependencies: { "my-dep": "file:./dep" },
              trustedDependencies: ["my-dep"],
            }),
          ),
          writeFile(join(packageDir, "capture.js"), capture),
          writeFile(
            join(packageDir, "dep", "package.json"),
            JSON.stringify({
              name: "my-dep",
              version: "2.0.0",
              scripts: scripts("preinstall", "install", "postinstall"),
            }),
          ),
          writeFile(join(packageDir, "dep", "capture.js"), capture),
        ]);

        const { stderr, exited } = spawn({
          cmd: [bunExe(), "install", `--linker=${linker}`],
          cwd: packageDir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          // These are left behind by the `bun run setup` that started this install.
          env: { ...testEnv, npm_lifecycle_event: "setup", npm_lifecycle_script: "bun install" },
        });
        const [err, exitCode] = await Promise.all([stderr.text(), exited]);
        expect(err).not.toContain("error:");

        expect(await file(join(packageDir, "events.txt")).text()).toBe(events("preinstall", "postinstall", "prepare"));
        expect(await file(join(packageDir, "node_modules", "my-dep", "events.txt")).text()).toBe(
          events("preinstall", "install", "postinstall"),
        );
        expect(exitCode).toBe(0);
      },
    );

    test("INIT_CWD is set to the correct directory", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "bun install.js",
          },
          dependencies: {
            "lifecycle-init-cwd": "1.0.0",
            "another-init-cwd": "npm:lifecycle-init-cwd@1.0.0",
          },
          trustedDependencies: ["lifecycle-init-cwd", "another-init-cwd"],
        }),
      );

      await writeFile(
        join(packageDir, "install.js"),
        `
      const fs = require("fs");
      const path = require("path");

      fs.writeFileSync(
      path.join(__dirname, "test.txt"),
      process.env.INIT_CWD || "does not exist"
      );
      `,
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      const out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ another-init-cwd@1.0.0",
        "+ lifecycle-init-cwd@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/lifecycle-init-cwd/test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/another-init-cwd/test.txt")).text()).toBe(packageDir);
    });

    test("failing lifecycle script should print output", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("hello");
      expect(await exited).toBe(1);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
    });

    test("failing root lifecycle script should print output correctly", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "fooooooooo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} -e "throw new Error('Oops!')"`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(await exited).toBe(1);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      const err = await stderr.text();
      expect(err).toContain("error: Oops!");
      expect(err).toContain('error: preinstall script from "fooooooooo" exited with 1');
    });

    test("exit 0 in lifecycle scripts works", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("--ignore-scripts should skip lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("hello");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-failing-postinstall@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("it should add `node-gyp rebuild` as the `install` script when `install` and `postinstall` don't exist and `binding.gyp` exists in the root of the package", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "binding-gyp-scripts": "1.5.0",
          },
          trustedDependencies: ["binding-gyp-scripts"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules/binding-gyp-scripts/build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts should not run for untrusted dependencies, and should run after adding to `trustedDependencies`", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const packageJSON: any = {
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "binding-gyp-scripts": "1.5.0",
        },
      };
      await writeFile(packageJson, JSON.stringify(packageJSON));

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        "2 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeFalse();

      packageJSON.trustedDependencies = ["binding-gyp-scripts"];
      await writeFile(packageJson, JSON.stringify(packageJSON));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts work in package root", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(splitErrLines(err).filter(line => line.startsWith("$ "))).toEqual(["$ node-gyp rebuild"]);
      let out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ node-gyp@1.5.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();

      await rm(join(packageDir, "build.node"));

      // The script is added again on every install, not only when the lockfile changes.
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(splitErrLines(err).filter(line => line.startsWith("$ "))).toEqual(["$ node-gyp rebuild"]);
      out = await stdout.text();
      expect(normalizeBunSnapshot(out)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        Checked 1 install across 2 packages (no changes)"
      `);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    test("auto node-gyp scripts work when scripts exists other than `install` and `preinstall`", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ node-gyp@1.5.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    test("auto node-gyp script does not drop the package's own postinstall", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // Local mock node-gyp so the injected `node-gyp rebuild` succeeds without
      // touching the registry.
      await mkdir(join(packageDir, "node-gyp-pkg"), { recursive: true });
      await writeFile(
        join(packageDir, "node-gyp-pkg", "package.json"),
        JSON.stringify({
          name: "node-gyp",
          version: "1.0.0",
          bin: { "node-gyp": "./node-gyp.js" },
        }),
      );
      await writeFile(
        join(packageDir, "node-gyp-pkg", "node-gyp.js"),
        `#!/usr/bin/env node\nrequire("fs").writeFileSync("build.node", "built");\n`,
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "file:./node-gyp-pkg",
          },
          scripts: {
            postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall.txt', 'ran')"`,
            prepare: `${bunExe()} -e "require('fs').writeFileSync('prepare.txt', 'ran')"`,
            postprepare: `${bunExe()} -e "require('fs').writeFileSync('postprepare.txt', 'ran')"`,
          },
        }),
      );
      await writeFile(join(packageDir, "binding.gyp"), "");

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      const out = await stdout.text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out).toContain("1 package installed");
      expect({
        // injected `node-gyp rebuild`
        "build.node": await exists(join(packageDir, "build.node")),
        // the package's own hooks must still run
        "postinstall": await exists(join(packageDir, "postinstall.txt")),
        "prepare": await exists(join(packageDir, "prepare.txt")),
        "postprepare": await exists(join(packageDir, "postprepare.txt")),
      }).toEqual({
        "build.node": true,
        "postinstall": true,
        "prepare": true,
        "postprepare": true,
      });
      expect(await exited).toBe(0);
    });

    for (const script of ["install", "preinstall"]) {
      test(`does not add auto node-gyp script when ${script} script exists`, async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        const packageJSON: any = {
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            [script]: "exit 0",
          },
        };
        await writeFile(packageJson, JSON.stringify(packageJSON));
        await writeFile(join(packageDir, "binding.gyp"), "");

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        const out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "+ node-gyp@1.5.0",
          "",
          "1 package installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "build.node"))).toBeFalse();
      });
    }

    test("git dependencies also run `preprepare`, `prepare`, and `postprepare` scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = {
        ...env,
        GITHUB_API_URL: github.url.origin,
        ...(forceWaiterThread ? { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : {}),
      };

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": githubDependency,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ lifecycle-install-test@github:${githubOwner}/${githubRepo}#${githubCommit.slice(0, 7)}`,
        "",
        "1 package installed",
        "",
        "Blocked 6 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeFalse();

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": githubDependency,
          },
          trustedDependencies: ["lifecycle-install-test"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeTrue();
    });

    test("root lifecycle scripts should wait for dependency lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]',
          },
        }),
      );

      // Package `uses-what-bin-slow` has an install script that will sleep for 1 second
      // before writing `what-bin.txt` to disk. The root package has an install script that
      // checks if this file exists. If the root package install script does not wait for
      // the other to finish, it will fail.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uses-what-bin-slow@1.0.0",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    // Lifecycle scripts run inside the installed package, so a script that writes `fileName`
    // leaves it in `node_modules/<package>/`. Packages whose script did not write it map to null.
    async function scriptOutputs(
      packageDir: string,
      packages: string[],
      fileName: string,
    ): Promise<Record<string, string | null>> {
      return Object.fromEntries(
        await Promise.all(
          packages.map(async pkg => {
            const path = join(packageDir, "node_modules", pkg, fileName);
            return [pkg, (await exists(path)) ? await file(path).text() : null];
          }),
        ),
      );
    }

    async function createPackagesWithScripts(
      packageDir: string,
      packageJson: string,
      packagesCount: number,
      scripts: Record<string, string>,
    ): Promise<string[]> {
      const dependencies: Record<string, string> = {};
      const dependenciesList: string[] = [];

      async function iterate(i) {
        const packageName: string = "stress-test-package-" + i;
        const packageVersion = "1.0." + i;

        dependencies[packageName] = "file:./" + packageName;
        dependenciesList[i] = packageName;

        const packagePath = join(packageDir, packageName);

        await Bun.write(
          join(packagePath, "package.json"),
          JSON.stringify({
            name: packageName,
            version: packageVersion,
            scripts,
          }),
        );
      }

      await Promise.all(Array.from({ length: packagesCount }, (_, i) => iterate(i)));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "stress-test",
          version: "1.0.0",
          dependencies,
          trustedDependencies: dependenciesList,
        }),
      );

      return dependenciesList;
    }

    test("reach max concurrent scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // Each script runs in its own package directory under node_modules. It keeps a marker file in
      // node_modules while it runs, and halfway through it records how many other scripts have a
      // marker there. Scripts that start together have all written their markers by then, so a
      // script that runs alongside more than one other script records it.
      const preinstall = [
        "const marker = '../running-' + process.pid",
        "await Bun.write(marker, '')",
        "Bun.sleepSync(250)",
        "const others = [...new Bun.Glob('running-*').scanSync('..')].length - 1",
        "Bun.sleepSync(250)",
        "await Bun.file(marker).delete()",
        "await Bun.write('preinstall.txt', String(others))",
      ].join("; ");
      const dependenciesList = await createPackagesWithScripts(packageDir, packageJson, 4, {
        preinstall: `${bunExe()} -e "${preinstall}"`,
      });

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--concurrent-scripts=2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`),
        "",
        "4 packages installed",
      ]);
      expect(exitCode).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      // Every script ran, and none of them ran alongside more than one other script.
      expect(await scriptOutputs(packageDir, dependenciesList, "preinstall.txt")).toEqual(
        Object.fromEntries(dependenciesList.map(dep => [dep, expect.stringMatching(/^[01]$/)])),
      );
    });

    test("stress test", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // The script is quick: `echo` is a shell builtin, so none of the 500 scripts starts a process
      // of its own (500 `bun` processes made this the slowest test in the file under ASAN). Default
      // number for max concurrent scripts.
      const dependenciesList = await createPackagesWithScripts(packageDir, packageJson, 500, {
        "postinstall": "echo postinstall > postinstall.txt",
      });

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`).sort((a, b) => a.localeCompare(b)),
        "",
        "500 packages installed",
      ]);

      expect(exitCode).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await scriptOutputs(packageDir, dependenciesList, "postinstall.txt")).toEqual(
        Object.fromEntries(dependenciesList.map(dep => [dep, "postinstall\n"])),
      );
    });

    test("it should install and use correct binary version", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // this should install `what-bin` in two places:
      //
      // - node_modules/.bin/what-bin@1.5.0
      // - node_modules/uses-what-bin/node_modules/.bin/what-bin@1.0.0

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "what-bin": "1.5.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "+ what-bin@1.5.0",
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.5.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.0.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
            "what-bin": "1.0.0",
          },
          scripts: {
            install: "what-bin",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      const firstLockfile = await (
        await file(join(packageDir, "bun.lock")).text()
      ).replaceAll(/localhost:\d+/g, "localhost:1234");
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.0.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.5.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      out = await stdout.text();
      err = await stderr.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.5.0"),
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      const secondLockfile = await (
        await file(join(packageDir, "bun.lock")).text()
      ).replaceAll(/localhost:\d+/g, "localhost:1234");
      expect(firstLockfile).toEqual(secondLockfile);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    // The three tests that use this check what `bun install` itself puts on the PATH of lifecycle
    // scripts, so the scripts get exactly `path` to search on top of that. The env can also carry
    // PATH under another spelling (`Path` on Windows), and a spawned bun keeps whichever spelling it
    // reads last, so all of them go.
    function envWithPath(env: Record<string, string>, path: string): Record<string, string> {
      return {
        ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH")),
        PATH: path,
      };
    }

    // Without a node-gyp dependency, the `node-gyp` that a lifecycle script finds is the script that
    // `bun install` writes to its temp dir, which runs `bun x node-gyp` with the `bun` that
    // `bun install` put next to its `node`. bunx installs the package outside of the project, where
    // the project's bunfig.toml does not apply, so the registry has to come from the environment.
    // The registry's node-gyp@latest writes the directory it runs in to `build.node`.
    function envForBunx(env: Record<string, string>): Record<string, string> {
      return { ...env, BUN_CONFIG_REGISTRY: verdaccio.registryUrl() };
    }

    test("node-gyp should always be available for lifecycle scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "node-gyp --version",
          },
        }),
      );
      // A PATH that is not empty, but has no node, bun or node-gyp on it: `bun install` has to add
      // its directories to it. ("ensureTempNodeGypScript works" starts from an empty PATH.)
      const emptyDir = join(packageDir, "empty");
      await mkdir(emptyDir);

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        // On Windows the shim is a .cmd file, and cmd.exe echoes its lines to stdout.
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env: envForBunx(envWithPath(testEnv, emptyDir)),
      });

      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(splitErrLines(err)).toEqual(["No packages! Deleted empty lockfile", "", "$ node-gyp --version", ""]);
      expect(exitCode).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "build.node")).text()).toBe(join(packageDir, "build.node"));
    });

    // if this test fails, `electron` might be removed from the default list
    test("default trusted dependencies should work", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(out).not.toContain("Blocked");
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("bun pm ls --trusted uses default trusted list when trustedDependencies is not set", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "electron": "1.0.0",
            "no-deps": "1.0.0",
          },
        }),
      );

      {
        const { stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });
        const err = await stderr.text();
        expect(err).not.toContain("error:");
        expect(err).toContain("Saved lockfile");
        expect(await exited).toBe(0);
      }

      // Without `trustedDependencies` in package.json, `--trusted` falls back to
      // the default trusted list. `electron` is on it, `no-deps` is not.
      {
        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "pm", "ls", "--trusted"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });
        const out = await stdout.text();
        expect(await stderr.text()).toBe("");
        expect(out).toBe(`${packageDir} node_modules (2 installed)
└── electron@1.0.0
`);
        expect(await exited).toBe(0);
      }

      // With `trustedDependencies` set, the default list is ignored.
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "electron": "1.0.0",
            "no-deps": "1.0.0",
          },
          trustedDependencies: ["no-deps"],
        }),
      );

      {
        const { stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });
        const err = await stderr.text();
        expect(err).not.toContain("error:");
        expect(await exited).toBe(0);
      }

      {
        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "pm", "ls", "--trusted"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env: testEnv,
        });
        const out = await stdout.text();
        expect(await stderr.text()).toBe("");
        expect(out).toBe(`${packageDir} node_modules (2 installed)
└── no-deps@1.0.0
`);
        expect(await exited).toBe(0);
      }
    });

    test("default trusted dependencies should not be used of trustedDependencies is populated", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            // fake electron package because it's in the default trustedDependencies list
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      // electron lifecycle scripts should run, uses-what-bin scripts should not run
      var err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      // now uses-what-bin scripts should run and electron scripts should not run.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("does not run any scripts if trustedDependencies is an empty list", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      const out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 2 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("default trusted dependencies should only apply to npm packages, not file: dependencies", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // Create a file: dependency named "esbuild" (which is in the default trusted dependencies list)
      // with a postinstall script that would fail if it ran
      const esbuildPath = join(packageDir, "local-esbuild");
      await mkdir(esbuildPath, { recursive: true });
      await writeFile(
        join(esbuildPath, "package.json"),
        JSON.stringify({
          name: "esbuild",
          version: "1.0.0",
          scripts: {
            postinstall: "exit 1",
          },
        }),
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            // file: dependency named "esbuild" - should NOT use default trusted list
            esbuild: "file:./local-esbuild",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      const out = await stdout.text();

      // The install should succeed because the postinstall script should NOT run
      // (file: dependencies don't use default trusted list, even if name matches)
      // The postinstall is blocked (not trusted), so we expect the "Blocked" message
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ esbuild@local-esbuild",
        "",
        "1 package installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
    });

    test("file: dependency with default trusted name should run scripts when explicitly added to trustedDependencies", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // Create a file: dependency named "esbuild" with a postinstall script that creates a marker file
      const esbuildPath = join(packageDir, "local-esbuild");
      await mkdir(esbuildPath, { recursive: true });
      await writeFile(
        join(esbuildPath, "package.json"),
        JSON.stringify({
          name: "esbuild",
          version: "1.0.0",
          scripts: {
            postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
          },
        }),
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            esbuild: "file:./local-esbuild",
          },
          // Explicitly trust the file: dependency
          trustedDependencies: ["esbuild"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      const out = await stdout.text();

      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ esbuild@local-esbuild",
        "",
        "1 package installed",
        "",
      ]);
      expect(out).not.toContain("Blocked");
      expect(await exited).toBe(0);

      // The postinstall script should have run because we explicitly trusted it
      expect(await exists(join(packageDir, "node_modules", "esbuild", "postinstall-ran.txt"))).toBeTrue();
    });

    test("trustedDependencies entry must match by name, not truncated hash", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // Trusted-dependency lookups are keyed by `Wyhash11::hash(0, name) as u32`
      // (the legacy 32-byte-round wyhash used by `String.Builder.string_hash`,
      // NOT `Bun.hash.wyhash`). These two distinct names share the truncated
      // 32-bit hash 0x6c4a82d1; they were found by an offline birthday search
      // over `pkg-<base36>` candidates against that exact hash function.
      const trustedName = "pkg-xjd";
      const colliderName = "pkg-ztd";

      const colliderPath = join(packageDir, "collider");
      await mkdir(colliderPath, { recursive: true });
      await writeFile(
        join(colliderPath, "package.json"),
        JSON.stringify({
          name: colliderName,
          version: "1.0.0",
          scripts: {
            postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
          },
        }),
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            [colliderName]: "file:./collider",
          },
          // Trusts a *different* name whose truncated hash collides with the
          // collider's. The collider's postinstall must NOT run.
          trustedDependencies: [trustedName],
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await stderr.text();
      let out = await stdout.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(out).toContain("Blocked 1 postinstall");
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "node_modules", colliderName))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeFalse();

      // Trusting the collider by its exact name still grants trust to the same
      // package. Start from a clean slate so this is a plain install with a
      // matching trustedDependencies entry.
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lock"), { force: true });
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            [colliderName]: "file:./collider",
          },
          trustedDependencies: [colliderName],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      out = await stdout.text();
      expect(err).not.toContain("error:");
      expect(out).not.toContain("Blocked");
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeTrue();
    });

    test("will run default trustedDependencies after install that didn't include them", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;
      await verdaccio.writeBunfig(packageDir, { saveTextLockfile: false, linker: "hoisted" });

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
          trustedDependencies: ["blah"],
        }),
      );

      // first install does not run electron scripts

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        "",
        "1 package installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
        }),
      );

      // The electron scripts should run now because it's in default trusted dependencies.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
    });

    describe("--trust", async () => {
      test("unhoisted untrusted scripts, none at root node_modules", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await Promise.all([
          write(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                // prevents real `uses-what-bin` from hoisting to root
                "uses-what-bin": "npm:a-dep@1.0.3",
              },
              workspaces: ["pkg1"],
            }),
          ),
          write(
            join(packageDir, "pkg1", "package.json"),
            JSON.stringify({
              name: "pkg1",
              dependencies: {
                "uses-what-bin": "1.0.0",
              },
            }),
          ),
        ]);

        await runBunInstall(testEnv, packageDir);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        const results = await Promise.all([
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin")),
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ]);

        expect(results).toEqual([true, false]);

        const { stderr, exited } = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await stderr.text();
        expect(err).not.toContain("error:");

        expect(await exited).toBe(0);

        expect(
          await exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ).toBeTrue();
      });

      test("must not trust a truncated-hash collision in the trusted subtree", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        // `--trust` collects the trusted subtree into a set keyed by
        // `Wyhash11::hash(0, name) as u32` (the legacy 32-byte-round wyhash
        // used by `String.Builder.string_hash`). "pkg-jodsufb" was found by an
        // offline targeted search over `pkg-<base36>` candidates so that its
        // truncated hash equals hash32("uses-what-bin") == 0x9f4d06e5.
        const colliderName = "pkg-jodsufb";

        const colliderPath = join(packageDir, "collider2");
        await mkdir(colliderPath, { recursive: true });
        await writeFile(
          join(colliderPath, "package.json"),
          JSON.stringify({
            name: colliderName,
            version: "1.0.0",
            scripts: {
              postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
            },
          }),
        );

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              [colliderName]: "file:./collider2",
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i", "--trust", "uses-what-bin@1.0.0"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        });

        const err = await stderr.text();
        const out = await stdout.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("error:");
        expect(await exited).toBe(0);

        // The package that was actually trusted ran its scripts...
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        // ...the hash-colliding package did not.
        expect(await exists(join(packageDir, "node_modules", colliderName, "postinstall-ran.txt"))).toBeFalse();

        // Only the name passed to --trust is written back to package.json.
        const pkgJson = await file(packageJson).json();
        expect(pkgJson.trustedDependencies).toEqual(["uses-what-bin"]);

        // The colliding alias is not persisted into the lockfile's
        // trustedDependencies either.
        const lockfile = await file(join(packageDir, "bun.lock")).text();
        const trusted = lockfile.match(/"trustedDependencies":\s*\[([^\]]*)\]/);
        expect(trusted).not.toBeNull();
        expect(trusted![1]).toContain('"uses-what-bin"');
        expect(trusted![1]).not.toContain(colliderName);
      });

      for (const linker of ["hoisted", "isolated"]) {
        test(`only trusts packages resolved inside the trusted subtree, not same-named dependencies elsewhere (${linker})`, async () => {
          using ctx = await setupTest();
          const { packageDir, packageJson, env } = ctx;
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          const localPath = join(packageDir, "local-what-bin");
          await mkdir(localPath, { recursive: true });
          await Promise.all([
            writeFile(
              join(localPath, "package.json"),
              JSON.stringify({
                name: "what-bin",
                version: "9.9.9",
                scripts: {
                  postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"`,
                },
              }),
            ),
            writeFile(
              packageJson,
              JSON.stringify({
                name: "foo",
                dependencies: {
                  "what-bin": "file:./local-what-bin",
                },
              }),
            ),
          ]);

          const { stderr, exited } = spawn({
            cmd: [bunExe(), "i", `--linker=${linker}`, "--trust", "uses-what-bin@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("error:");
          expect(await exited).toBe(0);

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await exists(join(packageDir, "node_modules", "what-bin", "postinstall-ran.txt"))).toBeFalse();
          expect(await file(join(packageDir, "node_modules", "what-bin", "package.json")).json()).toMatchObject({
            name: "what-bin",
            version: "9.9.9",
          });

          const pkgJson = await file(packageJson).json();
          expect(pkgJson.trustedDependencies).toEqual(["uses-what-bin"]);

          const lockfile = await file(join(packageDir, "bun.lock")).text();
          const trusted = lockfile.match(/"trustedDependencies":\s*\[([^\]]*)\]/);
          expect(trusted).not.toBeNull();
          expect(trusted![1]).toContain('"uses-what-bin"');
          expect(trusted![1]).not.toContain('"what-bin"');
        });
      }

      const trustTests = [
        {
          label: "only name",
          packageJson: {
            name: "foo",
          },
        },
        {
          label: "empty dependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
          },
        },
        {
          label: "populated dependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          },
        },

        {
          label: "empty trustedDependencies",
          packageJson: {
            name: "foo",
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies, empty trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          },
        },

        {
          label: "empty dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
            trustedDependencies: [],
          },
        },
      ];
      for (const { label, packageJson: pkgJsonFixture } of trustTests) {
        test(label, async () => {
          using ctx = await setupTest();
          const { packageDir, env } = ctx;
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(join(packageDir, "package.json"), JSON.stringify(pkgJsonFixture));

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "uses-what-bin@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          });

          let err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed uses-what-bin@1.0.0",
            "",
            "2 packages installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // another install should not error with json SyntaxError
          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          }));

          err = await stderr.text();
          expect(err).not.toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            "Checked 2 installs across 3 packages (no changes)",
          ]);
          expect(await exited).toBe(0);
        });
      }
      describe("packages without lifecycle scripts", async () => {
        test("initial install", async () => {
          using ctx = await setupTest();
          const { packageDir, packageJson, env } = ctx;
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@1.0.0",
            "",
            "1 package installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
            },
          });
        });
        test("already installed", async () => {
          using ctx = await setupTest();
          const { packageDir, packageJson, env } = ctx;
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
            }),
          );
          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          });

          let err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@2.0.0",
            "",
            "1 package installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });

          // oops, I wanted to run the lifecycle scripts for no-deps, I'll install
          // again with --trust.

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: testEnv,
          }));

          // oh, I didn't realize no-deps doesn't have
          // any lifecycle scripts. It shouldn't automatically add to
          // trustedDependencies.

          err = await stderr.text();
          expect(err).not.toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@2.0.0",
            "",
            expect.stringContaining("done"),
            "",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });
        });
      });
    });

    describe("updating trustedDependencies", async () => {
      test("existing trustedDependencies, unchanged trustedDependencies", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        });

        let err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          expect.stringContaining("+ uses-what-bin@1.0.0"),
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        // no changes, lockfile shouldn't be saved
        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        }));

        err = await stderr.text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
      });

      test("existing trustedDependencies, removing trustedDependencies", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        });

        let err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          expect.stringContaining("+ uses-what-bin@1.0.0"),
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        // this script should not run because uses-what-bin is no longer in trustedDependencies
        await rm(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"), { force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        }));

        err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        });
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      });

      test("non-existent trustedDependencies, then adding it", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        });

        let err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "+ electron@1.0.0",
          "",
          "1 package installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "electron": "1.0.0",
          },
        });

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["electron"],
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        await rm(join(packageDir, "node_modules", "electron", "preinstall.txt"), { force: true });

        // lockfile should save evenn though there are no changes to trustedDependencies due to
        // the default list

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: testEnv,
        }));

        err = await stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await stdout.text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 1 install across 2 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      });
    });

    test("node -p should work in postinstall scripts", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // With an empty PATH, the only `node` the script can find is the one `bun install` provides,
      // which is `bun install`'s own binary. A real node has no `process.versions.bun`.
      const postinstall = `node -p "require('fs').writeFileSync('postinstall.txt', process.versions.bun)"`;
      await writeFile(packageJson, JSON.stringify({ name: "foo", version: "1.0.0", scripts: { postinstall } }));

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: envWithPath(testEnv, ""),
      });

      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(splitErrLines(err)).toEqual(["No packages! Deleted empty lockfile", "", `$ ${postinstall}`, ""]);
      // `node -p` prints what `writeFileSync` returned.
      expect(normalizeBunSnapshot(out)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)
        undefined
         done"
      `);
      expect(exitCode).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe(process.versions.bun);
    });

    test("ensureTempNodeGypScript works", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: "node-gyp --version",
          },
        }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        // On Windows the shim is a .cmd file, and cmd.exe echoes its lines to stdout.
        stdout: "ignore",
        stderr: "pipe",
        stdin: "ignore",
        env: envForBunx(envWithPath(testEnv, "")),
      });

      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(splitErrLines(err)).toEqual(["No packages! Deleted empty lockfile", "", "$ node-gyp --version", ""]);
      expect(exitCode).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "build.node")).text()).toBe(join(packageDir, "build.node"));
    });

    test("bun pm trust and untrusted on missing package", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.5.0",
          },
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      let out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.5.0"),
        "",
        "2 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      // remove uses-what-bin from node_modules, bun pm trust and untrusted should handle missing package
      await rm(join(packageDir, "node_modules", "uses-what-bin"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "untrusted"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await stderr.text();
      expect(err).toContain("bun pm untrusted");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      out = await stdout.text();
      expect(out).toContain("Found 0 untrusted dependencies with scripts");
      expect(await exited).toBe(0);

      ({ stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(1);

      err = await stderr.text();
      expect(err).toContain("bun pm trust");
      expect(err).toContain("0 scripts ran");
      expect(err).toContain("uses-wha");
    });

    describe("add trusted, delete, then add again", async () => {
      // Either way the package leaves node_modules, with the what-bin only it needed.
      for (const withRm of [true, false]) {
        test(withRm ? "withRm" : "withoutRm", async () => {
          using ctx = await setupTest();
          const { packageDir, packageJson, env } = ctx;
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await verdaccio.writeBunfig(packageDir, { saveTextLockfile: false, linker: "hoisted" });
          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          });

          let err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            expect.stringContaining("+ no-deps@1.0.0"),
            expect.stringContaining("+ uses-what-bin@1.0.0"),
            "",
            "3 packages installed",
            "",
            "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
            "",
          ]);
          expect(await exited).toBe(0);
          assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await stderr.text();
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await stdout.text();
          expect(out).toContain("1 script ran across 1 package");
          expect(await exited).toBe(0);

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // now remove and install again
          if (withRm) {
            ({ stdout, stderr, exited } = spawn({
              cmd: [bunExe(), "rm", "uses-what-bin"],
              cwd: packageDir,
              stdout: "pipe",
              stderr: "pipe",
              env: testEnv,
            }));

            err = await stderr.text();
            expect(err).toContain("Saved lockfile");
            expect(err).not.toContain("not found");
            expect(err).not.toContain("error:");
            expect(err).not.toContain("warn:");
            out = await stdout.text();
            expect(out).toContain("1 package removed");
            expect(out).toContain("uses-what-bin");
            expect(await exited).toBe(0);
          }
          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await stdout.text();
          let expected = withRm
            ? ["", "Checked 1 install across 2 packages (no changes)"]
            : ["", expect.stringContaining("1 package removed")];
          expected = [expect.stringContaining("bun install v1."), ...expected];
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(expected);
          expect(await exited).toBe(0);
          expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "no-deps"]);

          // add again, bun pm untrusted should report it as untrusted

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            expect.stringContaining("+ uses-what-bin@1.0.0"),
            "",
            "2 packages installed",
            "",
            "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
            "",
          ]);

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "untrusted"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await stderr.text();
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await stdout.text();
          expect(out).toContain("./node_modules/uses-what-bin @1.0.0".replaceAll("/", sep));
          expect(await exited).toBe(0);
        });
      }
    });

    describe.if(!forceWaiterThread || process.platform === "linux")("does not use 100% cpu", async () => {
      test("install", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            scripts: {
              preinstall: `${bunExe()} -e 'Bun.sleepSync(1000)'`,
            },
          }),
        );

        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000);
      });

      test("bun pm trust", async () => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        const dep = isWindows ? "uses-what-bin-slow-window" : "uses-what-bin-slow";
        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [dep]: "1.0.0",
            },
          }),
        );

        var { exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeFalse();

        const proc = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeTrue();

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000 * (isWindows ? 5 : 1));
      });
    });

    // The message names the signal with the OS's name for its number (SIGUSR1
    // is 30 on macOS, which the Linux table called SIGPWR; 16 on Linux is
    // SIGSTKFLT, which had no name), and bun install then dies from the same
    // signal. Signal 40 is a Linux real-time signal with no name at all; it
    // used to be re-raised as SIGTERM.
    const signaled: [number, string][] = [
      [osConstants.signals.SIGUSR1, "terminated by SIGUSR1"],
      ...(isLinux
        ? ([
            [osConstants.signals.SIGSTKFLT, "terminated by SIGSTKFLT"],
            [40, "terminated by code 40"],
          ] as [number, string][])
        : []),
    ];
    test.skipIf(isWindows).each(signaled)(
      "a postinstall killed by signal %d is reported and re-raised",
      async (signal, message) => {
        using ctx = await setupTest();
        const { packageDir, packageJson, env } = ctx;
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({ name: "foo", version: "1.0.0", scripts: { postinstall: `kill -${signal} $$` } }),
        );

        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          env: testEnv,
        });
        const [, err, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(err).toContain(message);
        expect(exited).toBe(128 + signal);
      },
    );
  });

  describe.concurrent("stdout/stderr is inherited from root scripts during install", async () => {
    test("without packages", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(splitErrLines(err)).toEqual([
        "No packages! Deleted empty lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await stdout.text();
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("with a package", async () => {
      using ctx = await setupTest();
      const { packageDir, packageJson, env } = ctx;
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(splitErrLines(err)).toEqual([
        "Resolving dependencies",
        expect.stringContaining("Resolved, downloaded and extracted "),
        "Saved lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        expect.stringContaining("+ no-deps@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });
  });
}
