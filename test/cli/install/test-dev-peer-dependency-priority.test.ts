import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, stderrForInstall, tempDir } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function spawnBun(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: stderrForInstall(rawStderr), exitCode };
}

function bunfig(registryUrl: string, linker?: "isolated") {
  let text = `[install]\ncache = false\nregistry = "${registryUrl}"\n`;
  if (linker) text += `linker = "${linker}"\n`;
  return text;
}

// Each test has its own tempDir and spawns its own processes; nothing is shared.
test.concurrent("workspace devDependencies should take priority over peerDependencies for resolution", async () => {
  await using dir = tempDir("dev-peer-priority", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": bunfig(registry.registryUrl(), "isolated"),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      devDependencies: {
        "no-deps": "workspace:*", // workspace protocol for dev
      },
      peerDependencies: {
        "no-deps": "1.0.0", // would resolve from the registry
      },
    }),
    "packages/lib/test.js": `console.log(require("no-deps").version);`,
    // Workspace provides 2.0.0; the peer range asks for 1.0.0.
    "packages/no-deps/package.json": JSON.stringify({
      name: "no-deps",
      version: "2.0.0",
      main: "index.js",
    }),
    "packages/no-deps/index.js": `module.exports = { version: "2.0.0-workspace" };`,
  });

  // Initial install against the local registry.
  {
    const { stderr, exitCode } = await spawnBun(["install"], String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  // The devDependency (workspace) must win: only the workspace entry is recorded.
  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lockfile).toContain("no-deps@workspace:packages/no-deps");
  expect(lockfile).not.toContain(registry.registryUrl());

  // Re-install with the registry pointed at a server that fails every request. If
  // bun tried to re-resolve the peer dependency it would hit this server.
  let registryHits = 0;
  await using deadRegistry = Bun.serve({
    port: 0,
    fetch() {
      registryHits++;
      return new Response("unreachable", { status: 500 });
    },
  });
  await Bun.write(join(String(dir), "bunfig.toml"), bunfig(String(deadRegistry.url), "isolated"));

  {
    const { stderr, exitCode } = await spawnBun(["install"], String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  expect(registryHits).toBe(0);

  // The linked module is the workspace copy (devDependency), not the registry 1.0.0.
  const { stdout, stderr, exitCode } = await spawnBun(["packages/lib/test.js"], String(dir));
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("2.0.0-workspace");
  expect(exitCode).toBe(0);
});

test.concurrent("devDependencies and peerDependencies with different versions should coexist", async () => {
  await using dir = tempDir("dev-peer-different-versions", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": bunfig(registry.registryUrl(), "isolated"),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      devDependencies: {
        "utils": "1.0.0",
      },
      peerDependencies: {
        "utils": "^1.0.0",
      },
    }),
    "packages/utils/package.json": JSON.stringify({
      name: "utils",
      version: "1.0.0",
      main: "index.js",
    }),
    "packages/utils/index.js": `module.exports = { version: "1.0.0" };`,
  });

  const { stderr, exitCode } = await spawnBun(["install"], String(dir));
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lockfile).toContain("utils@workspace:packages/utils");
  expect(lockfile).not.toContain(registry.registryUrl());
});

test.concurrent("dependency behavior comparison prioritizes devDependencies", async () => {
  // No workspace here: both ranges resolve against the registry. The devDependency
  // pins 1.0.0 while the peerDependency range would otherwise float to 1.1.0.
  await using dir = tempDir("behavior-comparison", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      devDependencies: {
        "no-deps": "1.0.0",
      },
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    }),
    "bunfig.toml": bunfig(registry.registryUrl()),
  });

  const { stderr, exitCode } = await spawnBun(["install"], String(dir));
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // devDependency wins: 1.0.0 is installed, not the 1.1.0 the peer range would pick.
  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lockfile).toContain("no-deps@1.0.0");
  expect(lockfile).not.toContain("no-deps@1.1.0");

  const installed = await Bun.file(join(String(dir), "node_modules", "no-deps", "package.json")).json();
  expect(installed).toMatchObject({ name: "no-deps", version: "1.0.0" });
});

test.concurrent("Next.js monorepo scenario should not make unnecessary network requests", async () => {
  // Same shape as the original Next.js canary repro but with a registry package that
  // has no transitive dependencies. The devDependency is a plain semver that matches
  // the workspace package; the peerDependency range would pull a different version
  // from the registry if it took priority.
  await using dir = tempDir("nextjs-monorepo", {
    "package.json": JSON.stringify({
      name: "nextjs-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": bunfig(registry.registryUrl(), "isolated"),
    "packages/web/package.json": JSON.stringify({
      name: "web",
      version: "1.0.0",
      devDependencies: {
        "no-deps": "2.0.0", // matches the workspace package exactly
      },
      peerDependencies: {
        "no-deps": "^1.0.0", // would resolve to 1.1.0 from the registry
      },
    }),
    "packages/web/test.js": `console.log(require("no-deps").version);`,
    "packages/no-deps/package.json": JSON.stringify({
      name: "no-deps",
      version: "2.0.0",
      main: "index.js",
    }),
    "packages/no-deps/index.js": `module.exports = { version: "2.0.0-workspace" };`,
  });

  // Initial install against the local registry.
  {
    const { stderr, exitCode } = await spawnBun(["install"], String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  // The devDependency (workspace) must win: no registry tarball is recorded.
  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lockfile).toContain("no-deps@workspace:packages/no-deps");
  expect(lockfile).not.toContain(registry.registryUrl());

  // Re-install with a registry that fails every request. devDependencies taking
  // priority means the workspace copy is already linked and no lookup is needed.
  let registryHits = 0;
  await using deadRegistry = Bun.serve({
    port: 0,
    fetch() {
      registryHits++;
      return new Response("unreachable", { status: 500 });
    },
  });
  await Bun.write(join(String(dir), "bunfig.toml"), bunfig(String(deadRegistry.url), "isolated"));

  {
    const { stderr, exitCode } = await spawnBun(["install"], String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  expect(registryHits).toBe(0);

  // The linked module is the workspace copy (devDependency), not the registry copy.
  const { stdout, stderr, exitCode } = await spawnBun(["packages/web/test.js"], String(dir));
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("2.0.0-workspace");
  expect(exitCode).toBe(0);
});
