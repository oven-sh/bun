import { spawn } from "bun";
import { expect, test } from "bun:test";
import { exists } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Helper to create a minimal valid npm tarball in memory
function createTarball(name: string, version: string, extraFields?: Record<string, unknown>): Uint8Array {
  const packageJson = JSON.stringify({
    name,
    version,
    ...extraFields,
  });

  const files: Record<string, string> = {
    "package/package.json": packageJson,
    "package/index.js": `module.exports = "${name}@${version}";`,
  };

  const entries: Buffer[] = [];
  let tarSize = 0;

  for (const [path, content] of Object.entries(files)) {
    const contentBuf = Buffer.from(content, "utf8");
    const blockSize = Math.ceil((contentBuf.length + 512) / 512) * 512;
    const entry = Buffer.alloc(blockSize);

    // Write tar header
    entry.write(path, 0, Math.min(path.length, 99));
    entry.write("0000644", 100, 7); // mode
    entry.write("0000000", 108, 7); // uid
    entry.write("0000000", 116, 7); // gid
    entry.write(contentBuf.length.toString(8).padStart(11, "0"), 124, 11); // size
    entry.write("00000000000", 136, 11); // mtime
    entry.write("        ", 148, 8); // checksum space
    entry.write("0", 156, 1); // type flag

    // Calculate checksum
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += i >= 148 && i < 156 ? 32 : entry[i];
    }
    entry.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    // Write content
    contentBuf.copy(entry, 512);
    entries.push(entry);
    tarSize += blockSize;
  }

  // Add end-of-archive marker
  entries.push(Buffer.alloc(1024));
  tarSize += 1024;

  return Bun.gzipSync(Buffer.concat(entries, tarSize));
}

// Pre-create tarballs
const tarballs: Record<string, Uint8Array> = {
  "shared-dep-1.0.0": createTarball("shared-dep", "1.0.0"),
  "shared-dep-1.1.0": createTarball("shared-dep", "1.1.0"),
  "shared-dep-2.0.0": createTarball("shared-dep", "2.0.0"),
  "consumer-1.0.0": createTarball("consumer", "1.0.0", {
    dependencies: { "shared-dep": "^1.0.0" },
  }),
};

// Package metadata for the mock registry
const packages: Record<string, object> = {
  "shared-dep": {
    name: "shared-dep",
    "dist-tags": { latest: "2.0.0" },
    versions: {
      "1.0.0": {
        name: "shared-dep",
        version: "1.0.0",
        dist: { tarball: "REGISTRY_URL/shared-dep/-/shared-dep-1.0.0.tgz" },
      },
      "1.1.0": {
        name: "shared-dep",
        version: "1.1.0",
        dist: { tarball: "REGISTRY_URL/shared-dep/-/shared-dep-1.1.0.tgz" },
      },
      "2.0.0": {
        name: "shared-dep",
        version: "2.0.0",
        dist: { tarball: "REGISTRY_URL/shared-dep/-/shared-dep-2.0.0.tgz" },
      },
    },
  },
  consumer: {
    name: "consumer",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name: "consumer",
        version: "1.0.0",
        dependencies: { "shared-dep": "^1.0.0" },
        dist: { tarball: "REGISTRY_URL/consumer/-/consumer-1.0.0.tgz" },
      },
    },
  },
};

function createMockRegistry() {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Serve tarballs
      if (path.endsWith(".tgz")) {
        const filename = path.split("/").pop()!.replace(".tgz", "");
        const tarball = tarballs[filename];
        if (tarball) {
          return new Response(tarball, {
            headers: { "content-type": "application/octet-stream" },
          });
        }
        return new Response("Not found", { status: 404 });
      }

      // Serve package metadata
      const pkgName = path.slice(1); // Remove leading /
      const pkg = packages[pkgName];
      if (pkg) {
        const registryUrl = `http://localhost:${server.port}`;
        const body = JSON.stringify(pkg).replaceAll("REGISTRY_URL", registryUrl);
        return new Response(body, {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });
  return server;
}

test("bun add should deduplicate transitive deps when upgrading a root package (#27839)", async () => {
  using server = createMockRegistry();
  const registryUrl = `http://localhost:${server.port}`;

  using dir = tempDir("issue-27839", {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registryUrl}/"\nsaveTextLockfile = false\n`,
    "package.json": JSON.stringify({
      name: "test-project",
      dependencies: {
        "shared-dep": "1.0.0",
        consumer: "1.0.0",
      },
    }),
  });

  const packageDir = String(dir);
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };

  // Step 1: Initial install
  await using proc1 = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    env,
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);
  expect(stderr1).toContain("Saved lockfile");
  expect(stderr1).not.toContain("error:");
  expect(exitCode1).toBe(0);

  // shared-dep@1.0.0 should be hoisted (no nested copy)
  expect(await Bun.file(join(packageDir, "node_modules", "shared-dep", "package.json")).json()).toMatchObject({
    version: "1.0.0",
  });
  expect(await exists(join(packageDir, "node_modules", "consumer", "node_modules", "shared-dep"))).toBe(false);

  // Step 2: Upgrade shared-dep to 1.1.0 (still satisfies ^1.0.0)
  await using proc2 = spawn({
    cmd: [bunExe(), "add", "shared-dep@1.1.0"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    env,
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
  expect(stderr2).toContain("Saved lockfile");
  expect(stderr2).not.toContain("error:");
  expect(exitCode2).toBe(0);

  // Root should have the new version
  expect(await Bun.file(join(packageDir, "node_modules", "shared-dep", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });

  // KEY ASSERTION: No nested copy should exist since 1.1.0 satisfies ^1.0.0
  expect(await exists(join(packageDir, "node_modules", "consumer", "node_modules", "shared-dep"))).toBe(false);

  // Step 3: Upgrade shared-dep to 2.0.0 (does NOT satisfy ^1.0.0)
  await using proc3 = spawn({
    cmd: [bunExe(), "add", "shared-dep@2.0.0"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    env,
  });

  const [stdout3, stderr3, exitCode3] = await Promise.all([proc3.stdout.text(), proc3.stderr.text(), proc3.exited]);
  expect(stderr3).toContain("Saved lockfile");
  expect(stderr3).not.toContain("error:");
  expect(exitCode3).toBe(0);

  // Root should have 2.0.0
  expect(await Bun.file(join(packageDir, "node_modules", "shared-dep", "package.json")).json()).toMatchObject({
    version: "2.0.0",
  });

  // Nested copy SHOULD exist since 2.0.0 does NOT satisfy ^1.0.0
  expect(await exists(join(packageDir, "node_modules", "consumer", "node_modules", "shared-dep"))).toBe(true);
  expect(
    await Bun.file(join(packageDir, "node_modules", "consumer", "node_modules", "shared-dep", "package.json")).json(),
  ).toMatchObject({ version: "1.1.0" });
});
