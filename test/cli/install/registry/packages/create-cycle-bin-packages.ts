#!/usr/bin/env bun
/**
 * Creates two packages that form a dependency cycle and both expose a bin.
 * Used to test that `.bin/` links for cycle members are created deterministically
 * in isolated installs.
 */

import { $ } from "bun";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const pkgs = [
  { name: "cycle-bin-a", dep: "cycle-bin-b" },
  { name: "cycle-bin-b", dep: "cycle-bin-a" },
];

for (const { name, dep } of pkgs) {
  const tmp = join(packagesDir, `${name}-tmp`);
  const tarDir = join(tmp, "package");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tarDir, { recursive: true });

  await writeFile(
    join(tarDir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        bin: { [name]: "./bin.js" },
        dependencies: { [dep]: "1.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(tarDir, "bin.js"), `#!/usr/bin/env node\nconsole.log("${name}");\n`);
  // Pad the tarball so extraction takes long enough to expose the race where a
  // cycle peer reaches `check_if_blocked` before this package's files are on disk.
  for (let i = 0; i < 100; i++) {
    await writeFile(join(tarDir, `pad-${i}.js`), Buffer.alloc(8 * 1024, "x").toString());
  }

  await mkdir(join(packagesDir, name), { recursive: true });
  await $`cd ${tmp} && tar -czf ${join(packagesDir, name, `${name}-1.0.0.tgz`)} package`;
  await rm(tmp, { recursive: true, force: true });
}

for (const { name, dep } of pkgs) {
  const version = "1.0.0";
  const tarballName = `${name}-${version}.tgz`;
  const tarballBytes = await Bun.file(join(packagesDir, name, tarballName)).arrayBuffer();

  const sha512 = new Bun.CryptoHasher("sha512");
  sha512.update(tarballBytes);
  const integrity = `sha512-${Buffer.from(sha512.digest()).toString("base64")}`;

  const sha1 = new Bun.CryptoHasher("sha1");
  sha1.update(tarballBytes);
  const shasum = Buffer.from(sha1.digest()).toString("hex");

  await writeFile(
    join(packagesDir, name, "package.json"),
    JSON.stringify(
      {
        _id: name,
        name,
        "dist-tags": { latest: version },
        versions: {
          [version]: {
            name,
            version,
            _id: `${name}@${version}`,
            bin: { [name]: "./bin.js" },
            dependencies: { [dep]: version },
            dist: {
              integrity,
              shasum,
              tarball: `http://localhost:4873/${name}/-/${tarballName}`,
            },
          },
        },
      },
      null,
      2,
    ),
  );
}

console.log("created cycle-bin-a and cycle-bin-b");
