#!/usr/bin/env bun
// Generates the `zero-major` fixture (0.4.x and 0.5.x releases, nothing else) used by bun-audit.test.ts to check that
// `bun audit fix` treats 0.x minors as separate release lines.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const packages: Record<string, string[]> = {
  "zero-major": ["0.4.0", "0.4.1", "0.5.0", "0.5.1"],
};

for (const [name, versionList] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  let latest = "";
  for (const version of versionList) {
    const pkgJson = { name, version };
    const tarball = join(dir, `${name}-${version}.tgz`);
    await Bun.Archive.write(
      tarball,
      { "package/package.json": JSON.stringify(pkgJson, null, 2) },
      { compress: "gzip" },
    );

    const bytes = await Bun.file(tarball).bytes();
    versions[version] = {
      ...pkgJson,
      _id: `${name}@${version}`,
      dist: {
        integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${name}-${version}.tgz`,
      },
    };
    latest = version;
  }

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions }, null, 2),
  );
}

console.log("Created zero-major test package");
