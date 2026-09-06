#!/usr/bin/env bun
/**
 * Generates the `optional-peer-hoist-*` fixtures used by bun-lock.test.ts.
 *
 * Hoisting is breadth-first, so where a package lands can depend on whether an
 * optional peer is already bound to its target when the tree is built: bound,
 * the target's subtree is queued right after the dependent; unbound, only once
 * a regular dependency edge reaches the target. These packages make that
 * difference visible in bun.lock.
 *
 * Shape 1 (consumer + deep@1.0.0, optionally provider):
 *
 * - optional-peer-hoist-consumer@1.0.0    optional peer on optional-peer-hoist-target (any version)
 * - optional-peer-hoist-deep@1.0.0        -> deep-child@1.0.0
 * - optional-peer-hoist-deep-child@1.0.0  -> leaf@1.0.0, target@1.0.0
 * - optional-peer-hoist-target@1.0.0      -> leaf@2.0.0
 * - optional-peer-hoist-target@2.0.0      no dependencies
 * - optional-peer-hoist-leaf@1.0.0/2.0.0  no dependencies
 * - optional-peer-hoist-provider@1.0.0    -> target@2.0.0
 *
 * `consumer` sorts before `deep`, so with the peer bound, target@1.0.0 is placed
 * from consumer and its leaf@2.0.0 reaches the root before deep-child's
 * leaf@1.0.0; unbound, target is only placed once deep-child is reached and
 * leaf@1.0.0 wins the root.
 *
 * Shape 2 (consumer + consumer2 + deep@2.0.0) takes more than one extra hoist
 * pass to settle:
 *
 * - optional-peer-hoist-consumer2@1.0.0   optional peer on optional-peer-hoist-target2 (any version)
 * - optional-peer-hoist-deep@2.0.0        -> deep-child@2.0.0
 * - optional-peer-hoist-deep-child@2.0.0  -> leaf@1.0.0, target@3.0.0, tail@1.0.0
 * - optional-peer-hoist-target@3.0.0      -> leaf@3.0.0, and bundles target2@0.0.1
 * - optional-peer-hoist-leaf@3.0.0        -> target2@1.0.0
 * - optional-peer-hoist-target2@0.0.1     no dependencies (the bundled copy)
 * - optional-peer-hoist-target2@1.0.0     -> tail@2.0.0
 * - optional-peer-hoist-tail@1.0.0/2.0.0  no dependencies
 *
 * While consumer's peer is unbound, leaf@3.0.0 nests under target (deep-child's
 * leaf@1.0.0 holds the root), so its target2@1.0.0 runs into the bundled
 * target2@0.0.1 in target's node_modules and nests there too, out of reach of
 * consumer2's peer. Once consumer's peer is bound, leaf@3.0.0 is hoisted to the
 * root and target2@1.0.0 does reach consumer2's peer, but only after deep-child
 * has put tail@1.0.0 at the root. Once consumer2's peer is bound as well,
 * target2's subtree is queued from consumer2 and tail@2.0.0 takes the root.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const prefix = "optional-peer-hoist-";

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: true }>;
  bundleDependencies?: string[];
};

const optionalPeerOn = (suffix: string): Manifest => ({
  version: "1.0.0",
  peerDependencies: { [prefix + suffix]: "*" },
  peerDependenciesMeta: { [prefix + suffix]: { optional: true } },
});

const packages: Record<string, Manifest[]> = {
  consumer: [optionalPeerOn("target")],
  consumer2: [optionalPeerOn("target2")],
  deep: [
    { version: "1.0.0", dependencies: { [`${prefix}deep-child`]: "1.0.0" } },
    { version: "2.0.0", dependencies: { [`${prefix}deep-child`]: "2.0.0" } },
  ],
  "deep-child": [
    { version: "1.0.0", dependencies: { [`${prefix}leaf`]: "1.0.0", [`${prefix}target`]: "1.0.0" } },
    {
      version: "2.0.0",
      dependencies: { [`${prefix}leaf`]: "1.0.0", [`${prefix}target`]: "3.0.0", [`${prefix}tail`]: "1.0.0" },
    },
  ],
  target: [
    { version: "1.0.0", dependencies: { [`${prefix}leaf`]: "2.0.0" } },
    { version: "2.0.0" },
    {
      version: "3.0.0",
      dependencies: { [`${prefix}leaf`]: "3.0.0", [`${prefix}target2`]: "0.0.1" },
      bundleDependencies: [`${prefix}target2`],
    },
  ],
  target2: [{ version: "0.0.1" }, { version: "1.0.0", dependencies: { [`${prefix}tail`]: "2.0.0" } }],
  leaf: [
    { version: "1.0.0" },
    { version: "2.0.0" },
    { version: "3.0.0", dependencies: { [`${prefix}target2`]: "1.0.0" } },
  ],
  tail: [{ version: "1.0.0" }, { version: "2.0.0" }],
  provider: [{ version: "1.0.0", dependencies: { [`${prefix}target`]: "2.0.0" } }],
};

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
      files[`package/node_modules/${bundled}/package.json`] = JSON.stringify(
        { name: bundled, version: manifest.dependencies![bundled] },
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

console.log("Created optional-peer-hoist test packages");
