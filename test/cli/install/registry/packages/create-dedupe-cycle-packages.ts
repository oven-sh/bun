#!/usr/bin/env bun
// Generates the `dedupe-cycle-*` and `dedupe-divergent-peers` fixtures used
// by isolated-install.test.ts ("a package reached through a cycle dedupes
// into one store entry" and "early dedupe keeps declarer-specific peer
// resolutions"). `dedupe-cycle-a` and `dedupe-cycle-b` form a dependency
// cycle, `dedupe-cycle-peer` declares a peer that nothing in the graph
// provides, and `dedupe-divergent-peers` pulls in two declarers of that
// unprovided peer name with divergent ranges (`strict-peer-dep` peers on
// `no-deps@^2.0.0`).

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const packages: Record<string, Manifest[]> = {
  "dedupe-cycle-a": [{ version: "1.0.0", dependencies: { "dedupe-cycle-b": "1.0.0" } }],
  "dedupe-cycle-b": [
    { version: "1.0.0", dependencies: { "dedupe-cycle-a": "1.0.0", "dedupe-cycle-peer": "1.0.0" } },
  ],
  "dedupe-cycle-peer": [{ version: "1.0.0", peerDependencies: { "no-deps": "1.0.0" } }],
  "dedupe-divergent-peers": [
    { version: "1.0.0", dependencies: { "dedupe-cycle-peer": "1.0.0", "strict-peer-dep": "1.0.0" } },
  ],
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

console.log("Created dedupe-cycle-a, dedupe-cycle-b, dedupe-cycle-peer and dedupe-divergent-peers test packages");
