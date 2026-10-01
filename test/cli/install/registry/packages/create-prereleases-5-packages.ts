#!/usr/bin/env bun
/**
 * Generates the `prereleases-5` fixture used by the `bun outdated` tests.
 *
 * Its `latest` prerelease tag extends the older one byte for byte (`rc.1` ->
 * `rc.10`), so the colored version diff has no differing byte inside the
 * shorter tag and must color the appended bytes instead.
 *
 * - prereleases-5@1.0.0-rc.1
 * - prereleases-5@1.0.0-rc.10   (latest)
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const name = "prereleases-5";
const versionNames = ["1.0.0-rc.1", "1.0.0-rc.10"];

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
