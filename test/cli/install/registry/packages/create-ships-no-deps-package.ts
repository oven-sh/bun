#!/usr/bin/env bun
/**
 * Generates the `ships-no-deps` fixture used by bun-patch.test.ts.
 *
 * `ships-no-deps@1.0.0` declares no dependencies, but its tarball ships a copy
 * of `no-deps@1.0.0` under `node_modules/no-deps/`. That is what a bundled
 * dependency's own dependencies look like when the registry manifest of the
 * bundled package no longer lists them: the copy is on disk after an install,
 * but no lockfile row points at it.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const name = "ships-no-deps";
const version = "1.0.0";

const dir = join(packagesDir, name);
await mkdir(dir, { recursive: true });

const pkgJson = { name, version, main: "index.js" };

const files: Record<string, string> = {
  "package/package.json": JSON.stringify(pkgJson, null, 2),
  "package/index.js": `module.exports = require("no-deps");\n`,
  "package/node_modules/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }, null, 2),
  "package/node_modules/no-deps/index.js": `module.exports = "no-deps@1.0.0";\n`,
};

const tarball = join(dir, `${name}-${version}.tgz`);
await Bun.Archive.write(tarball, files, { compress: "gzip" });

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

console.log("Created ships-no-deps test package");
