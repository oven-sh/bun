#!/usr/bin/env bun
/**
 * Generates the `bundled-unpublished` fixture used by bun-install-registry.test.ts
 * and bun-prune.test.ts.
 *
 * Every version bundles a dependency that the registry cannot provide. The only
 * copy is the one the tarball ships in `node_modules/`, the way `npm pack` writes
 * a bundled dependency.
 *
 * - bundled-unpublished@1.0.0  bundles `unpublished-dep`, a name the registry
 *   does not have (the manifest request answers 404).
 * - bundled-unpublished@2.0.0  sets `bundleDependencies: true`. Its dependencies
 *   are the same unpublished name, an `npm:` alias of it, a dist-tag, a
 *   `workspace:` and a `catalog:` spec of other unpublished names, a version of
 *   `no-deps` that was never published, and `a-dep@1.0.1`, which the registry
 *   does have.
 * - bundled-unpublished@3.0.0  bundles the unpublished version of `no-deps` and
 *   depends on `one-dep`, which needs a published version of `no-deps`.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const name = "bundled-unpublished";

const dir = join(packagesDir, name);
await mkdir(dir, { recursive: true });

type Shipped = { folder: string; name: string; version: string };

const unpublishedDep: Shipped = { folder: "unpublished-dep", name: "unpublished-dep", version: "1.0.0" };
const unpublishedAlias: Shipped = { folder: "unpublished-alias", name: "unpublished-dep", version: "1.0.0" };
const unpublishedTag: Shipped = { folder: "unpublished-tag", name: "unpublished-tag", version: "1.0.0" };
const unpublishedWorkspace: Shipped = {
  folder: "unpublished-workspace",
  name: "unpublished-workspace",
  version: "1.0.0",
};
const unpublishedCatalog: Shipped = { folder: "unpublished-catalog", name: "unpublished-catalog", version: "1.0.0" };
const unpublishedNoDeps: Shipped = { folder: "no-deps", name: "no-deps", version: "9.9.9" };
const publishedADep: Shipped = { folder: "a-dep", name: "a-dep", version: "1.0.1" };

const releases: { version: string; manifest: object; shipped: Shipped[] }[] = [
  {
    version: "1.0.0",
    manifest: {
      dependencies: { "unpublished-dep": "1.0.0" },
      bundleDependencies: ["unpublished-dep"],
    },
    shipped: [unpublishedDep],
  },
  {
    version: "2.0.0",
    manifest: {
      dependencies: {
        "a-dep": "1.0.1",
        "no-deps": "9.9.9",
        "unpublished-alias": "npm:unpublished-dep@1.0.0",
        "unpublished-catalog": "catalog:",
        "unpublished-dep": "^1.0.0",
        "unpublished-tag": "nightly",
        "unpublished-workspace": "workspace:*",
      },
      bundleDependencies: true,
    },
    shipped: [
      publishedADep,
      unpublishedNoDeps,
      unpublishedAlias,
      unpublishedCatalog,
      unpublishedDep,
      unpublishedTag,
      unpublishedWorkspace,
    ],
  },
  {
    version: "3.0.0",
    manifest: {
      dependencies: { "no-deps": "9.9.9", "one-dep": "1.0.0" },
      bundleDependencies: ["no-deps"],
    },
    shipped: [unpublishedNoDeps],
  },
];

const versions: Record<string, object> = {};
let latest = "";
for (const { version, manifest, shipped } of releases) {
  const pkgJson = { name, version, main: "index.js", ...manifest };

  const files: Record<string, string> = {
    "package/package.json": JSON.stringify(pkgJson, null, 2),
    // Each bundled folder, mapped to what the copy inside this tarball exports.
    "package/index.js": `module.exports = {\n${shipped
      .map(({ folder }) => `  ${JSON.stringify(folder)}: require(${JSON.stringify(folder)}),\n`)
      .join("")}};\n`,
  };
  for (const dep of shipped) {
    files[`package/node_modules/${dep.folder}/package.json`] = JSON.stringify(
      { name: dep.name, version: dep.version, main: "index.js" },
      null,
      2,
    );
    files[`package/node_modules/${dep.folder}/index.js`] =
      `module.exports = ${JSON.stringify(`${dep.name}@${dep.version} shipped in ${name}`)};\n`;
  }

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

console.log("Created bundled-unpublished test packages");
