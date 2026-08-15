#!/usr/bin/env bun
// Generates the `catalog-peer` / `catalog-dep` fixtures (registry packages shipping a raw `catalog:` specifier) used by catalogs.test.ts.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const packages: Record<string, Manifest[]> = {
  "catalog-peer": [
    { version: "1.0.0", peerDependencies: { "no-deps": "catalog:" } },
    { version: "2.0.0", peerDependencies: { "no-deps": "catalog:peers" } },
  ],
  "catalog-dep": [{ version: "1.0.0", dependencies: { "no-deps": "catalog:" } }],
};

for (const [name, manifests] of Object.entries(packages)) {
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

console.log("Created catalog-peer and catalog-dep test packages");
