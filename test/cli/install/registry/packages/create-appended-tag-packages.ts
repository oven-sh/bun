#!/usr/bin/env bun
/**
 * Generates the `prereleases-5` and `build-metadata-2` fixtures used by the
 * `bun outdated` tests.
 *
 * In each one the `latest` tag extends the older tag byte for byte (`rc.1` ->
 * `rc.10`, `build.1` -> `build.10`), so the colored version diff has no
 * differing byte inside the shorter tag and must color the appended bytes.
 * The `prereleases-5` latest also carries a build tag longer than the 8 bytes
 * a semver string stores inline, so it is read from the manifest buffer.
 * Tarball names use `-` in place of `+`: the registry rejects a `+` in the
 * tarball URL, and the name of the file does not have to match the version.
 *
 * - prereleases-5@1.0.0-rc.1
 * - prereleases-5@1.0.0-rc.10+build.20240101   (latest)
 * - build-metadata-2@1.0.0+build.1
 * - build-metadata-2@1.0.1+build.10            (latest)
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packages: Record<string, string[]> = {
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
