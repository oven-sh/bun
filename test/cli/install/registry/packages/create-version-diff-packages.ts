#!/usr/bin/env bun
/**
 * Generates the fixtures for the colored version diff tests of `bun outdated`
 * and `bun update -i`.
 *
 * Semver tag strings up to 8 bytes are stored inline; longer ones are offsets
 * into the string buffer they were parsed from, so printing a tag against the
 * wrong buffer is only observable with a tag longer than that. A `latest` tag
 * that extends the older tag byte for byte (`rc.1` -> `rc.10`) has no differing
 * byte inside the shorter tag, so the diff has to color the appended bytes.
 *
 * - build-metadata-1@1.0.0
 * - build-metadata-1@1.1.0-rc.0
 * - build-metadata-1@1.1.0-rc.1+build.20240101   (latest)
 * - prereleases-5@1.0.0-rc.1
 * - prereleases-5@1.0.0-rc.10+build.20240101     (latest)
 * - build-metadata-2@1.0.0+build.1
 * - build-metadata-2@1.0.1+build.10              (latest)
 *
 * Tarball names use `-` in place of `+`: the registry rejects a `+` in the
 * tarball URL, and the name of the file does not have to match the version.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packages: Record<string, string[]> = {
  "build-metadata-1": ["1.0.0", "1.1.0-rc.0", "1.1.0-rc.1+build.20240101"],
  "prereleases-5": ["1.0.0-rc.1", "1.0.0-rc.10+build.20240101"],
  "build-metadata-2": ["1.0.0+build.1", "1.0.1+build.10"],
};

for (const [name, versionNames] of Object.entries(packages)) {
  const dir = join(import.meta.dir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  for (const version of versionNames) {
    const pkgJson = { name, version };
    const tarballName = `${name}-${version.replaceAll("+", "-")}.tgz`;
    const tarball = join(dir, tarballName);
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
        tarball: `http://localhost:4873/${name}/-/${tarballName}`,
      },
    };
  }

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest: versionNames.at(-1) }, versions }, null, 2),
  );

  console.log(`Created ${name} test package`);
}
