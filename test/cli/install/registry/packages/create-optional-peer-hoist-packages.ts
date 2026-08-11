#!/usr/bin/env bun
/**
 * Generates the `optional-peer-hoist-*` fixtures used by bun-lock.test.ts.
 *
 * The shape makes the hoisted position of `optional-peer-hoist-leaf` depend on
 * whether `consumer`'s optional peer is already bound to `target` when the
 * tree is hoisted:
 *
 * - optional-peer-hoist-consumer@1.0.0    optional peer on optional-peer-hoist-target (any version)
 * - optional-peer-hoist-deep@1.0.0        depends on optional-peer-hoist-deep-child@1.0.0
 * - optional-peer-hoist-deep-child@1.0.0  depends on optional-peer-hoist-leaf@1.0.0 and optional-peer-hoist-target@1.0.0
 * - optional-peer-hoist-target@1.0.0      depends on optional-peer-hoist-leaf@2.0.0
 * - optional-peer-hoist-target@2.0.0      no dependencies
 * - optional-peer-hoist-leaf@1.0.0/2.0.0  no dependencies
 * - optional-peer-hoist-provider@1.0.0    depends on optional-peer-hoist-target@2.0.0
 *
 * Hoisting is breadth-first and `consumer` sorts before `deep` (and `provider`),
 * so with the peer bound, `target@1.0.0` is placed from `consumer` and its
 * `leaf@2.0.0` reaches the root before `deep-child`'s `leaf@1.0.0`. With the
 * peer unbound, `target` is only placed once `deep-child` is reached, and
 * `leaf@1.0.0` wins the root instead.
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
};

const packages: Record<string, Manifest[]> = {
  consumer: [
    {
      version: "1.0.0",
      peerDependencies: { [`${prefix}target`]: "*" },
      peerDependenciesMeta: { [`${prefix}target`]: { optional: true } },
    },
  ],
  deep: [{ version: "1.0.0", dependencies: { [`${prefix}deep-child`]: "1.0.0" } }],
  "deep-child": [
    {
      version: "1.0.0",
      dependencies: { [`${prefix}leaf`]: "1.0.0", [`${prefix}target`]: "1.0.0" },
    },
  ],
  target: [{ version: "1.0.0", dependencies: { [`${prefix}leaf`]: "2.0.0" } }, { version: "2.0.0" }],
  leaf: [{ version: "1.0.0" }, { version: "2.0.0" }],
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
    const tarball = join(dir, `${name}-${manifest.version}.tgz`);
    await Bun.Archive.write(
      tarball,
      { "package/package.json": JSON.stringify(pkgJson, null, 2) },
      { compress: "gzip" },
    );

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
