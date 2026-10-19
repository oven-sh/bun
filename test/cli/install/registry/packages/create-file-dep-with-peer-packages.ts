#!/usr/bin/env bun
/**
 * Generates the fixtures for a registry package that declares a `file:`
 * dependency while one of its dependencies peer-depends on the same name
 * (isolated-install.test.ts, "transitive file dependencies of registry packages").
 *
 * - file-dep-with-peer-on-files@1.0.0  "files": "file:the-files", -> peer-on-files@1.0.0;
 *                                      ships the-files/
 * - peer-on-files@1.0.0                optional peer on "files"; also ships a the-files/
 *                                      folder of its own, which nothing declares
 *
 * The `file:` path is written without `./` so that a root dependency on a folder
 * named the-files (normalized to the same path) loads as the same bun.lock row.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const packages: Record<string, object> = {
  "file-dep-with-peer-on-files": {
    dependencies: { "files": "file:the-files", "peer-on-files": "1.0.0" },
  },
  "peer-on-files": {
    peerDependencies: { files: "*" },
    peerDependenciesMeta: { files: { optional: true } },
  },
};

for (const [name, manifest] of Object.entries(packages)) {
  const version = "1.0.0";
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const pkgJson = { name, version, ...manifest };
  const tarball = join(dir, `${name}-${version}.tgz`);
  await Bun.Archive.write(
    tarball,
    {
      "package/package.json": JSON.stringify(pkgJson, null, 2),
      "package/the-files/package.json": JSON.stringify({ name: "files", version }, null, 2),
      "package/the-files/index.js": `module.exports = "the-files shipped by ${name}";\n`,
    },
    { compress: "gzip" },
  );

  const bytes = await Bun.file(tarball).bytes();
  const versions = {
    [version]: {
      ...pkgJson,
      _id: `${name}@${version}`,
      dist: {
        integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${name}-${version}.tgz`,
      },
    },
  };

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest: version }, versions }, null, 2),
  );
}

console.log("Created file-dep-with-peer-on-files and peer-on-files test packages");
