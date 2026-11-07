#!/usr/bin/env bun
/**
 * Generates the `bundled-file` fixture used by bun-install-registry.test.ts.
 *
 * Both versions depend on `bundled-file-dep` through a `file:` spec
 * (`file:vendor/bundled-file-dep`) and ship both `vendor/bundled-file-dep/`
 * and a copy under `node_modules/bundled-file-dep/`, the way `npm pack` does
 * for a bundled `file:` dependency.
 *
 * - bundled-file@1.0.0  lists the dependency in `bundleDependencies`. A `file:`
 *   resolution has its `bundled: true` marker at a different index in bun.lock
 *   than an npm resolution, so an install from the lockfile must still treat
 *   the dependency as bundled.
 * - bundled-file@2.0.0  does not bundle it. The install has to link the
 *   `file:` dependency over the files the tarball already put in place.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const name = "bundled-file";
const depName = "bundled-file-dep";

const dir = join(packagesDir, name);
await mkdir(dir, { recursive: true });

const depPkgJson = JSON.stringify({ name: depName, version: "1.0.0", main: "index.js" }, null, 2);
const depIndex = `module.exports = "${depName}";\n`;

const versions: Record<string, object> = {};
let latest = "";
for (const [version, bundled] of [
  ["1.0.0", true],
  ["2.0.0", false],
] as const) {
  const pkgJson = {
    name,
    version,
    dependencies: { [depName]: `file:vendor/${depName}` },
    ...(bundled ? { bundleDependencies: [depName] } : {}),
  };

  const files: Record<string, string> = {
    "package/package.json": JSON.stringify(pkgJson, null, 2),
    "package/index.js": `module.exports = require("${depName}");\n`,
    [`package/vendor/${depName}/package.json`]: depPkgJson,
    [`package/vendor/${depName}/index.js`]: depIndex,
    [`package/node_modules/${depName}/package.json`]: depPkgJson,
    [`package/node_modules/${depName}/index.js`]: depIndex,
  };

  const tarball = join(dir, `${name}-${version}.tgz`);
  await Bun.Archive.write(tarball, files, { compress: "gzip" });

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

console.log("Created bundled-file test packages");
