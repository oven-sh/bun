#!/usr/bin/env bun
/**
 * Generates the `bundled-shadow-*` fixtures used by bun-lock.test.ts.
 *
 * The dependencies of a bundled dependency are hoisted no further than the
 * bundling package's node_modules. That folder is also what the bundling
 * package itself, and any regular dependency nested inside it, resolve through
 * on their way up the tree, and a loaded bun.lock rebinds their edges by
 * walking up the saved paths. So a dependency of the bundle may only land
 * there if none of them resolve that name to something else higher up.
 *
 * The bundling package resolves the name higher up:
 *
 * - bundled-shadow-host@1.0.0    -> shared@1.0.0, and bundles inner@1.0.0
 * - bundled-shadow-inner@1.0.0   -> shared@2.0.0
 * - bundled-shadow-shared@1.0.0  no dependencies
 * - bundled-shadow-shared@2.0.0  no dependencies
 *
 * host's shared@1.0.0 is hoisted to the root, so inner's shared@2.0.0 has to
 * stay at `host/inner/shared` in bun.lock; at `host/shared` it would be what
 * host's own `shared` edge resolves to when the lockfile is loaded again.
 *
 * The same through an optional peer that is still unbound when the bundle is
 * hoisted, and gets bound to the bundle's own copy:
 *
 * - bundled-shadow-peer-host@1.0.0   -> shared@1.0.0, and bundles peer-inner@1.0.0
 * - bundled-shadow-peer-inner@1.0.0  -> peer-leaf@1.0.0, optional peer on shared
 * - bundled-shadow-peer-leaf@1.0.0   -> shared@2.0.0
 *
 * And a regular dependency nested inside the bundling package resolves the
 * name higher up (installed next to consumer@2.0.0 and mid@2.0.0 at the root so
 * that consumer@1.0.0 nests under deep-host and mid@1.0.0 under consumer):
 *
 * - bundled-shadow-deep-host@1.0.0  -> consumer@1.0.0, and bundles wrapper@1.0.0
 * - bundled-shadow-consumer@1.0.0   -> mid@1.0.0
 * - bundled-shadow-consumer@2.0.0   no dependencies
 * - bundled-shadow-mid@1.0.0        -> shared@1.0.0
 * - bundled-shadow-mid@2.0.0        no dependencies
 * - bundled-shadow-wrapper@1.0.0    -> inner@1.0.0
 *
 * Hoisting is breadth-first and consumer sorts before wrapper, so mid's
 * shared@1.0.0 has been hoisted to the root (up through deep-host's
 * node_modules) by the time inner's shared@2.0.0 reaches that folder.
 *
 * The tarballs carry their bundled packages like `npm pack` would, so the
 * bundled copies are what gets installed for them.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const prefix = "bundled-shadow-";

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: true }>;
  bundleDependencies?: string[];
};

const packages: Record<string, Manifest[]> = {
  host: [
    {
      version: "1.0.0",
      dependencies: { [`${prefix}inner`]: "1.0.0", [`${prefix}shared`]: "1.0.0" },
      bundleDependencies: [`${prefix}inner`],
    },
  ],
  inner: [{ version: "1.0.0", dependencies: { [`${prefix}shared`]: "2.0.0" } }],
  shared: [{ version: "1.0.0" }, { version: "2.0.0" }],
  "peer-host": [
    {
      version: "1.0.0",
      dependencies: { [`${prefix}peer-inner`]: "1.0.0", [`${prefix}shared`]: "1.0.0" },
      bundleDependencies: [`${prefix}peer-inner`],
    },
  ],
  "peer-inner": [
    {
      version: "1.0.0",
      dependencies: { [`${prefix}peer-leaf`]: "1.0.0" },
      peerDependencies: { [`${prefix}shared`]: "*" },
      peerDependenciesMeta: { [`${prefix}shared`]: { optional: true } },
    },
  ],
  "peer-leaf": [{ version: "1.0.0", dependencies: { [`${prefix}shared`]: "2.0.0" } }],
  "deep-host": [
    {
      version: "1.0.0",
      dependencies: { [`${prefix}consumer`]: "1.0.0", [`${prefix}wrapper`]: "1.0.0" },
      bundleDependencies: [`${prefix}wrapper`],
    },
  ],
  consumer: [{ version: "1.0.0", dependencies: { [`${prefix}mid`]: "1.0.0" } }, { version: "2.0.0" }],
  mid: [{ version: "1.0.0", dependencies: { [`${prefix}shared`]: "1.0.0" } }, { version: "2.0.0" }],
  wrapper: [{ version: "1.0.0", dependencies: { [`${prefix}inner`]: "1.0.0" } }],
};

function manifestOf(name: string, version: string): Manifest {
  const manifest = packages[name.slice(prefix.length)]?.find(m => m.version === version);
  if (!manifest) throw new Error(`no manifest for ${name}@${version}`);
  return manifest;
}

// Lays a package out under `dir` the way it would be inside a published
// tarball, with each of its dependencies nested in its own node_modules.
function addBundledTree(files: Record<string, string>, dir: string, name: string, version: string) {
  const manifest = manifestOf(name, version);
  files[`${dir}/package.json`] = JSON.stringify({ name, ...manifest }, null, 2);
  for (const [dep, depVersion] of Object.entries(manifest.dependencies ?? {})) {
    addBundledTree(files, `${dir}/node_modules/${dep}`, dep, depVersion);
  }
}

for (const [suffix, manifests] of Object.entries(packages)) {
  const name = prefix + suffix;
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  let latest = "";
  for (const manifest of manifests) {
    const pkgJson = { name, ...manifest };
    const files: Record<string, string> = { "package/package.json": JSON.stringify(pkgJson, null, 2) };
    for (const bundled of manifest.bundleDependencies ?? []) {
      addBundledTree(files, `package/node_modules/${bundled}`, bundled, manifest.dependencies![bundled]);
    }
    const tarball = join(dir, `${name}-${manifest.version}.tgz`);
    await Bun.Archive.write(tarball, files, { compress: "gzip" });

    const bytes = await Bun.file(tarball).bytes();
    versions[manifest.version] = {
      ...pkgJson,
      _id: `${name}@${manifest.version}`,
      dist: {
        integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${name}-${manifest.version}.tgz`,
      },
    };
    latest = manifest.version;
  }

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions }, null, 2),
  );
}

console.log("Created bundled-shadow test packages");
