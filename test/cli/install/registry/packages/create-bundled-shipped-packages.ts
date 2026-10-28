#!/usr/bin/env bun
/**
 * Generates the `bundled-shipped-*`, `bundled-*-host` and `bundled-peer-plugin` fixtures used by
 * bun-install-registry.test.ts and bun-prune.test.ts.
 *
 * - bundled-shipped-inner@1.0.0    depends on `no-deps@1.0.0`.
 * - bundled-shipped-sibling@1.0.0  depends on `no-deps@1.0.0`.
 * - bundled-range-inner@1.0.0      depends on `no-deps@^1.0.0` and `a-dep@^1.0.0`.
 * - bundled-peer-plugin@1.0.0      has a peer dependency on `no-deps`.
 * - bundled-shipped-host@1.0.0     bundles `bundled-shipped-inner` and depends on `one-dep@1.0.0`
 *   (which needs `no-deps@1.0.1`). The tarball ships `node_modules/bundled-shipped-inner/` and,
 *   the way `npm pack` flattens a bundle's own dependencies, `node_modules/no-deps/` at 1.0.0.
 * - bundled-nested-host@1.0.0      bundles `bundled-shipped-inner` and depends on
 *   `bundled-shipped-sibling@1.0.0`. The tarball nests the bundle's `no-deps` under it:
 *   `node_modules/bundled-shipped-inner/node_modules/no-deps/`.
 * - bundled-range-host@1.0.0       bundles `bundled-range-inner` and depends on `one-dep@1.0.0`.
 *   The tarball ships `no-deps@1.0.0` and `a-dep@1.0.1` flattened: older than what the
 *   registry resolves the ranges to.
 * - bundled-conflict-host@1.0.0    bundles `bundled-shipped-inner` and depends on `no-deps@2.0.0`
 *   itself, so the tarball nests the bundle's `no-deps@1.0.0` under it.
 * - bundled-peer-host@1.0.0        bundles `no-deps@1.0.0` and depends on `bundled-peer-plugin`.
 *
 * A dependency nested under a host that needs another `no-deps` must not hoist into the
 * folder the tarball shipped, and one that needs the same `no-deps` must not rely on it.
 * A peer shares the bundled copy.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

async function publish(name: string, version: string, pkgJson: object, files: Record<string, string>) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const tarball = join(dir, `${name}-${version}.tgz`);
  await Bun.Archive.write(
    tarball,
    { "package/package.json": JSON.stringify(pkgJson, null, 2), ...files },
    { compress: "gzip" },
  );

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
}

const innerPkgJson = {
  name: "bundled-shipped-inner",
  version: "1.0.0",
  main: "index.js",
  dependencies: { "no-deps": "1.0.0" },
};
const innerIndex = `module.exports = require("no-deps/package.json").version;\n`;

await publish("bundled-shipped-inner", "1.0.0", innerPkgJson, {
  "package/index.js": innerIndex,
});

await publish(
  "bundled-shipped-sibling",
  "1.0.0",
  {
    name: "bundled-shipped-sibling",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "no-deps": "1.0.0" },
  },
  { "package/index.js": innerIndex },
);

const shippedNoDeps = JSON.stringify({ name: "no-deps", version: "1.0.0" }, null, 2);

await publish(
  "bundled-nested-host",
  "1.0.0",
  {
    name: "bundled-nested-host",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "bundled-shipped-inner": "1.0.0", "bundled-shipped-sibling": "1.0.0" },
    bundleDependencies: ["bundled-shipped-inner"],
  },
  {
    "package/index.js": `module.exports = require("bundled-shipped-inner");\n`,
    "package/node_modules/bundled-shipped-inner/package.json": JSON.stringify(innerPkgJson, null, 2),
    "package/node_modules/bundled-shipped-inner/index.js": innerIndex,
    "package/node_modules/bundled-shipped-inner/node_modules/no-deps/package.json": shippedNoDeps,
    "package/node_modules/bundled-shipped-inner/node_modules/no-deps/index.js": `module.exports = "no-deps";\n`,
  },
);

await publish(
  "bundled-shipped-host",
  "1.0.0",
  {
    name: "bundled-shipped-host",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "bundled-shipped-inner": "1.0.0", "one-dep": "1.0.0" },
    bundleDependencies: ["bundled-shipped-inner"],
  },
  {
    "package/index.js": `module.exports = require("bundled-shipped-inner");\n`,
    "package/node_modules/bundled-shipped-inner/package.json": JSON.stringify(innerPkgJson, null, 2),
    "package/node_modules/bundled-shipped-inner/index.js": innerIndex,
    "package/node_modules/no-deps/package.json": shippedNoDeps,
    "package/node_modules/no-deps/index.js": `module.exports = "no-deps";\n`,
  },
);

const rangeInnerPkgJson = {
  name: "bundled-range-inner",
  version: "1.0.0",
  main: "index.js",
  dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.0" },
};

await publish("bundled-range-inner", "1.0.0", rangeInnerPkgJson, {
  "package/index.js": innerIndex,
});

await publish(
  "bundled-range-host",
  "1.0.0",
  {
    name: "bundled-range-host",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "bundled-range-inner": "1.0.0", "one-dep": "1.0.0" },
    bundleDependencies: ["bundled-range-inner"],
  },
  {
    "package/index.js": `module.exports = require("bundled-range-inner");\n`,
    "package/node_modules/bundled-range-inner/package.json": JSON.stringify(rangeInnerPkgJson, null, 2),
    "package/node_modules/bundled-range-inner/index.js": innerIndex,
    "package/node_modules/no-deps/package.json": shippedNoDeps,
    "package/node_modules/no-deps/index.js": `module.exports = "no-deps";\n`,
    "package/node_modules/a-dep/package.json": JSON.stringify({ name: "a-dep", version: "1.0.1" }, null, 2),
    "package/node_modules/a-dep/index.js": `module.exports = "a-dep";\n`,
  },
);

await publish(
  "bundled-conflict-host",
  "1.0.0",
  {
    name: "bundled-conflict-host",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "bundled-shipped-inner": "1.0.0", "no-deps": "2.0.0" },
    bundleDependencies: ["bundled-shipped-inner"],
  },
  {
    "package/index.js": `module.exports = [require("bundled-shipped-inner"), require("no-deps/package.json").version];\n`,
    "package/node_modules/bundled-shipped-inner/package.json": JSON.stringify(innerPkgJson, null, 2),
    "package/node_modules/bundled-shipped-inner/index.js": innerIndex,
    "package/node_modules/bundled-shipped-inner/node_modules/no-deps/package.json": shippedNoDeps,
    "package/node_modules/bundled-shipped-inner/node_modules/no-deps/index.js": `module.exports = "no-deps";\n`,
  },
);

await publish(
  "bundled-peer-plugin",
  "1.0.0",
  {
    name: "bundled-peer-plugin",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { "no-deps": "*" },
  },
  { "package/index.js": `module.exports = require.resolve("no-deps/package.json");\n` },
);

await publish(
  "bundled-peer-host",
  "1.0.0",
  {
    name: "bundled-peer-host",
    version: "1.0.0",
    main: "index.js",
    dependencies: { "no-deps": "1.0.0", "bundled-peer-plugin": "1.0.0" },
    bundleDependencies: ["no-deps"],
  },
  {
    "package/index.js": `module.exports = [require.resolve("no-deps/package.json"), require("bundled-peer-plugin")];\n`,
    "package/node_modules/no-deps/package.json": shippedNoDeps,
    "package/node_modules/no-deps/index.js": `module.exports = "no-deps";\n`,
  },
);

console.log("Created bundled-shipped test packages");
