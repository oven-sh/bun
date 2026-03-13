// https://github.com/oven-sh/bun/issues/28062

import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const fixturePackagesDir = join(import.meta.dir, "..", "..", "cli", "install", "registry", "packages");
const packageNames = [
  "a-dep",
  "uses-a-dep-1",
  "uses-a-dep-2",
  "uses-a-dep-3",
  "uses-a-dep-4",
  "uses-a-dep-5",
  "uses-a-dep-6",
  "uses-a-dep-7",
  "uses-a-dep-8",
  "uses-a-dep-9",
  "uses-a-dep-10",
] as const;

// These tests install packages from a local registry and are a bit slow on Windows.
setDefaultTimeout(30_000);

type RegistryMetadata = {
  versions: Record<string, { dist?: { tarball?: string } }>;
};

type InstallResult = {
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

function fixtureDirFor(packageName: string) {
  return join(fixturePackagesDir, packageName);
}

async function loadMetadata(origin: string) {
  return new Map(
    await Promise.all(
      packageNames.map(async packageName => {
        const file = await readFile(join(fixtureDirFor(packageName), "package.json"), "utf8");
        const metadata = JSON.parse(file) as RegistryMetadata;

        for (const version of Object.values(metadata.versions)) {
          if (version.dist?.tarball) {
            version.dist.tarball = version.dist.tarball.replace("http://localhost:4873", origin);
          }
        }

        return [packageName, JSON.stringify(metadata)] as const;
      }),
    ),
  );
}

async function writeProject(projectDir: string, bunfig: string, packageJson: string) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "bunfig.toml"), bunfig);
  await writeFile(join(projectDir, "package.json"), packageJson);
}

async function resetProject(projectDir: string) {
  await Promise.all([
    rm(join(projectDir, "node_modules"), { recursive: true, force: true }),
    rm(join(projectDir, "bun.lock"), { force: true }),
    rm(join(projectDir, "package-lock.json"), { force: true }),
  ]);
}

async function runInstall(cwd: string, sharedCacheDir: string): Promise<InstallResult> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache", "--verbose"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: sharedCacheDir,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { cwd, stdout, stderr, exitCode };
}

function expectSuccessfulInstalls(label: string, results: InstallResult[]) {
  for (const result of results) {
    if (result.exitCode !== 0 || result.stderr.includes("failed opening cache/package/version dir")) {
      console.error(`${label} failed for ${result.cwd}`);
      console.error(result.stdout);
      console.error(result.stderr);
    }

    expect(result.stderr).not.toContain("failed opening cache/package/version dir");
    expect(result.exitCode).toBe(0);
  }
}

test.skipIf(!isWindows)("parallel shared-cache installs with --no-cache should not lose cache package dirs", async () => {
  using root = tempDir("issue-28062", {});
  const rootDir = String(root);
  const sharedCacheDir = join(rootDir, ".shared-cache");
  const projects = [join(rootDir, "a"), join(rootDir, "b")];
  const rootDependencies = Object.fromEntries(packageNames.slice(1).map(packageName => [packageName, "1.0.0"]));
  let metadataByPackage = new Map<string, string>();

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (parts.length === 1 && metadataByPackage.has(parts[0])) {
        return new Response(metadataByPackage.get(parts[0]), {
          headers: { "content-type": "application/json" },
        });
      }

      if (parts.length === 3 && parts[1] === "-" && metadataByPackage.has(parts[0])) {
        return new Response(Bun.file(join(fixtureDirFor(parts[0]), parts[2])));
      }

      return new Response("not found", { status: 404 });
    },
  });

  metadataByPackage = await loadMetadata(`http://localhost:${server.port}`);
  const bunfig = `
[install]
saveTextLockfile = false
registry = "http://localhost:${server.port}/"
linker = "hoisted"
`;
  const packageJson = JSON.stringify(
    {
      name: "shared-cache-race",
      private: true,
      dependencies: rootDependencies,
    },
    null,
    2,
  );

  await Promise.all(
    projects.map(projectDir => writeProject(projectDir, bunfig, packageJson)),
  );

  const reset = async () => {
    await Promise.all([
      rm(sharedCacheDir, { recursive: true, force: true }),
      ...projects.map(resetProject),
    ]);
    await mkdir(sharedCacheDir, { recursive: true });
  };

  await reset();
  expectSuccessfulInstalls("serial", [
    await runInstall(projects[0], sharedCacheDir),
    await runInstall(projects[1], sharedCacheDir),
  ]);

  await reset();
  expectSuccessfulInstalls(
    "parallel",
    await Promise.all(projects.map(projectDir => runInstall(projectDir, sharedCacheDir))),
  );
});
