import { file } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { join } from "node:path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

// Reports what it was asked to scan, then flags all of it as fatal: an update
// that consults this scanner cannot succeed, so a successful update proves the
// scanner was never run.
const scannerSource = `
  export const scanner = {
    version: "1",
    scan: async ({ packages }) => {
      console.log("scanner received: " + packages.map(pkg => pkg.name + "@" + pkg.version).join(", "));
      return packages.map(pkg => ({
        package: pkg.name,
        description: "Fatal security issue detected",
        level: "fatal",
        url: "https://example.com/critical",
      }));
    },
  };
`;

// The three things `bun update moo` changes: the package.json range, the
// lockfile resolution and the package on disk. Every test starts from this state.
const installedState = { range: ">=0.1.0", locked: "moo@0.1.0", installed: "0.1.0" };

async function mooState(ctx: TestContext) {
  const [packageJson, lockfile, installed] = await Promise.all([
    file(join(ctx.package_dir, "package.json")).json(),
    file(join(ctx.package_dir, "bun.lock")).text(),
    file(join(ctx.package_dir, "node_modules/moo/package.json")).json(),
  ]);
  return {
    range: packageJson.dependencies.moo,
    locked: (Bun.JSONC.parse(lockfile) as { packages: Record<string, [string, ...unknown[]]> }).packages.moo[0],
    installed: installed.version,
  };
}

// Writes out what `bun install` leaves behind for `installedState` (the
// lockfile and node_modules entry are what it writes against this registry),
// which saves spawning an install per test. The registry has since published
// 0.2.0. The scanner file always exists; only bunfig.toml decides whether bun
// uses it.
async function projectWithMooInstalled({ scanner }: { scanner: boolean }) {
  const ctx = await createTestContext();
  const urls: string[] = [];
  setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.1.0": {}, "0.2.0": {} }));

  const files = {
    "bunfig.toml": Bun.TOML.stringify({
      install: {
        // Without this, manifests and tarballs come from the machine-wide cache
        // and the requests asserted below never reach the registry.
        cache: false,
        registry: ctx.registry_url,
        security: scanner ? { scanner: "./scanner.ts" } : undefined,
      },
    })!,
    "scanner.ts": scannerSource,
    "package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { moo: installedState.range } }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "my-app", dependencies: { moo: installedState.range } } },
      packages: { moo: [installedState.locked, `${ctx.registry_url}moo-${installedState.installed}.tgz`, {}, ""] },
    }),
    "node_modules/moo/package.json": JSON.stringify({ name: "moo", version: installedState.installed }),
  };
  await Promise.all(Object.entries(files).map(([name, contents]) => Bun.write(join(ctx.package_dir, name), contents)));
  return { ctx, urls };
}

async function updateMoo(ctx: TestContext) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "moo"],
    cwd: ctx.package_dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: normalizeBunSnapshot(stdout),
    // Only printed when the scanner takes over a second, i.e. on slow debug builds.
    stderr: normalizeBunSnapshot(stderr.replace(/^\[\.\/scanner\.ts\] Scanning 1 package took \d+ms\r?\n/m, "")),
    exitCode,
  };
}

test.concurrent("security scanner blocks bun update on fatal advisory", async () => {
  const { ctx, urls } = await projectWithMooInstalled({ scanner: true });
  try {
    const { stdout, stderr, exitCode } = await updateMoo(ctx);
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)
      scanner received: moo@0.2.0

        FATAL: moo
          via my-app › moo
          Fatal security issue detected
          https://example.com/critical

      1 advisory (1 fatal)
      Installation aborted due to fatal security advisories"
    `);
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [2]"
    `);
    expect(exitCode).toBe(1);

    // The advisory stopped the update right after resolution: the 0.2.0
    // tarball was never downloaded and nothing on disk moved off 0.1.0.
    expect(urls).toEqual([`${ctx.registry_url}moo`]);
    expect(await mooState(ctx)).toEqual(installedState);
  } finally {
    destroyTestContext(ctx);
  }
});

test.concurrent("security scanner does not run on bun update when not configured", async () => {
  const { ctx, urls } = await projectWithMooInstalled({ scanner: false });
  try {
    const { stdout, stderr, exitCode } = await updateMoo(ctx);
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      installed moo@0.2.0

      1 package installed"
    `);
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(exitCode).toBe(0);

    expect(urls).toEqual([`${ctx.registry_url}moo`, `${ctx.registry_url}moo-0.2.0.tgz`]);
    expect(await mooState(ctx)).toEqual({ range: "^0.2.0", locked: "moo@0.2.0", installed: "0.2.0" });
  } finally {
    destroyTestContext(ctx);
  }
});
