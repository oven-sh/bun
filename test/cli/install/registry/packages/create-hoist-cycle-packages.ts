#!/usr/bin/env bun
/**
 * Generates the `hoist-*-cycle-*` fixtures used by hoist.test.ts.
 *
 * Each shape is a dependency cycle the hoister can only lay out by nesting:
 * every package in the cycle conflicts with the version of its name one level
 * up, so without a cutoff the tree builder nests copies forever.
 *
 * hoist-cycle (plain dependencies, two versions of each name):
 *
 * - hoist-cycle-x@1.0.0 -> hoist-cycle-y@1.0.0
 * - hoist-cycle-y@1.0.0 -> hoist-cycle-x@2.0.0
 * - hoist-cycle-x@2.0.0 -> hoist-cycle-y@2.0.0
 * - hoist-cycle-y@2.0.0 -> hoist-cycle-x@1.0.0
 *
 * hoist-bundled-cycle: a package bundling a plugin that has a peer dependency
 * back on the package bundling it.
 *
 * - hoist-bundled-cycle-host@1.0.0    -> plugin@1.0.0 (bundled)
 * - hoist-bundled-cycle-plugin@1.0.0  peer on host@1.0.0
 *
 * hoist-optional-peer-cycle: the cycle is closed through an optional peer.
 * An optional peer is bound while the tree is built, to whichever version of
 * its name is closest to the copy being processed, and that one binding is
 * shared by every copy of the package. With x@2.0.0 at the root and x@1.0.0
 * nested under `entry`, y@2.0.0 is reached both next to x@1.0.0 (through z,
 * which binds the peer to it) and below a nested x@2.0.0, where that binding
 * conflicts and x@1.0.0 is nested again, which starts the cycle over.
 *
 * - hoist-optional-peer-cycle-entry@1.0.0 -> x@1.0.0
 * - hoist-optional-peer-cycle-x@1.0.0     -> y@1.0.0, z@1.0.0
 * - hoist-optional-peer-cycle-x@2.0.0     -> y@2.0.0, z@2.0.0
 * - hoist-optional-peer-cycle-y@1.0.0     peer on x@2.0.0
 * - hoist-optional-peer-cycle-y@2.0.0     optional peer on x@1.0.0
 * - hoist-optional-peer-cycle-z@1.0.0     -> y@2.0.0
 * - hoist-optional-peer-cycle-z@2.0.0     no dependencies
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: true }>;
  bundleDependencies?: string[];
};

const cycle = "hoist-cycle-";
const bundled = "hoist-bundled-cycle-";
const optional = "hoist-optional-peer-cycle-";

const packages: Record<string, Manifest[]> = {
  [`${cycle}x`]: [
    { version: "1.0.0", dependencies: { [`${cycle}y`]: "1.0.0" } },
    { version: "2.0.0", dependencies: { [`${cycle}y`]: "2.0.0" } },
  ],
  [`${cycle}y`]: [
    { version: "1.0.0", dependencies: { [`${cycle}x`]: "2.0.0" } },
    { version: "2.0.0", dependencies: { [`${cycle}x`]: "1.0.0" } },
  ],

  [`${bundled}host`]: [
    {
      version: "1.0.0",
      dependencies: { [`${bundled}plugin`]: "1.0.0" },
      bundleDependencies: [`${bundled}plugin`],
    },
  ],
  [`${bundled}plugin`]: [{ version: "1.0.0", peerDependencies: { [`${bundled}host`]: "1.0.0" } }],

  [`${optional}entry`]: [{ version: "1.0.0", dependencies: { [`${optional}x`]: "1.0.0" } }],
  [`${optional}x`]: [
    { version: "1.0.0", dependencies: { [`${optional}y`]: "1.0.0", [`${optional}z`]: "1.0.0" } },
    { version: "2.0.0", dependencies: { [`${optional}y`]: "2.0.0", [`${optional}z`]: "2.0.0" } },
  ],
  [`${optional}y`]: [
    { version: "1.0.0", peerDependencies: { [`${optional}x`]: "2.0.0" } },
    {
      version: "2.0.0",
      peerDependencies: { [`${optional}x`]: "1.0.0" },
      peerDependenciesMeta: { [`${optional}x`]: { optional: true } },
    },
  ],
  [`${optional}z`]: [{ version: "1.0.0", dependencies: { [`${optional}y`]: "2.0.0" } }, { version: "2.0.0" }],
};

for (const [name, manifests] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  let latest = "";
  for (const manifest of manifests) {
    const pkgJson = { name, ...manifest };
    const files: Record<string, string> = { "package/package.json": JSON.stringify(pkgJson, null, 2) };
    for (const dep of manifest.bundleDependencies ?? []) {
      files[`package/node_modules/${dep}/package.json`] = JSON.stringify(
        { name: dep, version: manifest.dependencies![dep] },
        null,
        2,
      );
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

console.log("Created hoist cycle test packages");
