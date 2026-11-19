#!/usr/bin/env bun
/**
 * Generates the fixtures used by the "peer dependency on bun" tests in
 * bun-install-registry.test.ts.
 *
 * - bun@1.0.0 / bun@1.1.0    stand-ins for the npm `bun` package
 * - peer-on-bun@1.0.0        non-optional peer on bun (">=1.0.0")
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const packages: Record<string, Manifest[]> = {
  bun: [{ version: "1.0.0" }, { version: "1.1.0" }],
  "peer-on-bun": [{ version: "1.0.0", peerDependencies: { bun: ">=1.0.0" } }],
};

for (const [name, manifests] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  let latest = "";
  for (const manifest of manifests) {
    const pkgJson = { name, ...manifest };
    const files: Record<string, string> = { "package/package.json": JSON.stringify(pkgJson, null, 2) };
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

console.log("Created bun-peer test packages");
