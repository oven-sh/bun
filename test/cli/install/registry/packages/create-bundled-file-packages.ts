#!/usr/bin/env bun
/**
 * Generates the `bundled-file` fixture used by bun-install-registry.test.ts.
 *
 * Every version depends on `bundled-file-dep` through a `file:` spec.
 *
 * 1.0.0 and 2.0.0 point the spec inside the package
 * (`file:vendor/bundled-file-dep`) and ship both `vendor/bundled-file-dep/` and
 * a copy under `node_modules/bundled-file-dep/`, the way `npm pack` does for a
 * bundled `file:` dependency.
 *
 * - bundled-file@1.0.0  lists the dependency in `bundleDependencies`. A `file:`
 *   resolution has its `bundled: true` marker at a different index in bun.lock
 *   than an npm resolution, so an install from the lockfile must still treat
 *   the dependency as bundled.
 * - bundled-file@2.0.0  does not bundle it. The install has to link the
 *   `file:` dependency over the files the tarball already put in place.
 *
 * 3.0.0 and 4.0.0 point the spec outside the package
 * (`file:../bundled-file-dep`), the way a package published from a monorepo
 * does. The tarball cannot ship that directory.
 *
 * - bundled-file@3.0.0  does not bundle it. A registry package must not link a
 *   directory outside itself, so the install must refuse the path.
 * - bundled-file@4.0.0  lists the dependency in `bundleDependencies` and ships
 *   the copy under `node_modules/bundled-file-dep/`. The copy is the
 *   dependency, so the install must not refuse the path.
 * - bundled-file@5.0.0  is 4.0.0 plus an `optionalDependencies` group. The
 *   bundled name is in `dependencies`, and the manifest parser must keep it
 *   bundled when a later dependency group exists.
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
for (const { version, inside, bundled, optional } of [
  { version: "1.0.0", inside: true, bundled: true },
  { version: "2.0.0", inside: true, bundled: false },
  { version: "3.0.0", inside: false, bundled: false },
  { version: "4.0.0", inside: false, bundled: true },
  { version: "5.0.0", inside: false, bundled: true, optional: true },
]) {
  const pkgJson = {
    name,
    version,
    dependencies: { [depName]: inside ? `file:vendor/${depName}` : `file:../${depName}` },
    ...(optional ? { optionalDependencies: { "no-deps": "1.0.0" } } : {}),
    ...(bundled ? { bundleDependencies: [depName] } : {}),
  };

  const files: Record<string, string> = {
    "package/package.json": JSON.stringify(pkgJson, null, 2),
    "package/index.js": `module.exports = require("${depName}");\n`,
  };
  if (inside) {
    files[`package/vendor/${depName}/package.json`] = depPkgJson;
    files[`package/vendor/${depName}/index.js`] = depIndex;
  }
  if (inside || bundled) {
    files[`package/node_modules/${depName}/package.json`] = depPkgJson;
    files[`package/node_modules/${depName}/index.js`] = depIndex;
  }

  // Bun.Archive stamps the current time on every entry, so a second write
  // changes the integrity. Keep a tarball that already exists.
  const tarball = join(dir, `${name}-${version}.tgz`);
  if (!(await Bun.file(tarball).exists())) {
    await Bun.Archive.write(tarball, files, { compress: "gzip" });
  }

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
