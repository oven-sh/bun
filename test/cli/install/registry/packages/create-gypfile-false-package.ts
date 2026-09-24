#!/usr/bin/env bun
/**
 * Generates the `gypfile-false` fixture used by bun-install-lifecycle-scripts.test.ts.
 *
 * The package ships a `binding.gyp`, has no `install` or `preinstall` script,
 * and sets `"gypfile": false`, the way better-sqlite3 does. It depends on the
 * mock `node-gyp` fixture, whose `node-gyp rebuild` writes `build.node` into
 * the package directory, so a test can tell whether the default script ran.
 * Its `postinstall` writes `postinstall.txt` so a test can tell that the
 * package's own scripts still run.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const name = "gypfile-false";
const version = "1.0.0";

const dir = join(packagesDir, name);
await mkdir(dir, { recursive: true });

const pkgJson = {
  name,
  version,
  gypfile: false,
  dependencies: { "node-gyp": "1.5.0" },
  scripts: {
    postinstall: `node -e "require('fs').writeFileSync('postinstall.txt', 'ran')"`,
  },
};

const files: Record<string, string> = {
  "package/package.json": JSON.stringify(pkgJson, null, 2),
  "package/binding.gyp": "{'targets':[{'target_name':'x','sources':['missing.cc']}]}\n",
  "package/index.js": `module.exports = "${name}";\n`,
};

const tarball = join(dir, `${name}-${version}.tgz`);
await Bun.Archive.write(tarball, files, { compress: "gzip" });

const bytes = await Bun.file(tarball).bytes();
const versions = {
  [version]: {
    ...pkgJson,
    _id: `${name}@${version}`,
    hasInstallScript: true,
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

console.log("Created gypfile-false test package");
