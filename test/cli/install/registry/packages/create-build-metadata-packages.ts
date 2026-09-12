#!/usr/bin/env bun
/**
 * Generates the `build-metadata-1` fixture used by the `bun outdated` and
 * `bun update -i` tests.
 *
 * Its `latest` version carries both a prerelease tag and a build tag longer
 * than 8 bytes. Semver tag strings up to 8 bytes are stored inline; longer ones
 * are offsets into the string buffer they were parsed from, so printing a tag
 * against the wrong buffer is only observable with a tag this long.
 *
 * - build-metadata-1@1.0.0
 * - build-metadata-1@1.1.0-rc.0
 * - build-metadata-1@1.1.0-rc.1+build.20240101   (latest)
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const name = "build-metadata-1";
const versionNames = ["1.0.0", "1.1.0-rc.0", "1.1.0-rc.1+build.20240101"];

const dir = join(import.meta.dir, name);
await mkdir(dir, { recursive: true });

const versions: Record<string, object> = {};
for (const version of versionNames) {
  const pkgJson = { name, version };
  const tarball = join(dir, `${name}-${version}.tgz`);
  await Bun.Archive.write(tarball, { "package/package.json": JSON.stringify(pkgJson, null, 2) }, { compress: "gzip" });

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
}

await writeFile(
  join(dir, "package.json"),
  JSON.stringify({ _id: name, name, "dist-tags": { latest: versionNames.at(-1) }, versions }, null, 2),
);

console.log(`Created ${name} test package`);
