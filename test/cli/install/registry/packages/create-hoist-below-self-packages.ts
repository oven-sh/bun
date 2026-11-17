#!/usr/bin/env bun
/**
 * Generates the fixtures hoist.test.ts uses to pin layouts where a package has
 * to be installed again somewhere below another copy of itself.
 *
 * A dependency is nested inside its dependent when the nearest node_modules
 * holding that name has a different version. When the nested version depends
 * back on the first one, the first one is installed a second time further
 * down, and its own dependencies have to be laid out again from there: some of
 * them are now shadowed by what was nested in between.
 *
 * below-self (the project depends on a@1.0.0, b@2.0.0, c@2.0.0, e@2.0.0):
 *
 * - below-self-a@1.0.0 -> b@1.0.0, e@1.0.0
 * - below-self-b@1.0.0 -> a@2.0.0
 * - below-self-a@2.0.0 -> c@1.0.0, e@3.0.0
 * - below-self-c@1.0.0 -> a@1.0.0
 * - b@2.0.0, c@2.0.0, e@1.0.0, e@2.0.0, e@3.0.0 have no dependencies
 *
 * The second a@1.0.0 sits below a@2.0.0's e@3.0.0, so it needs an e@1.0.0 of
 * its own.
 *
 * below-self-again (the project depends on a@1.0.0, b@2.0.0, c@2.0.0):
 *
 * - below-self-again-a@1.0.0 -> b@1.0.0
 * - below-self-again-b@1.0.0 -> a@2.0.0
 * - below-self-again-a@2.0.0 -> b@3.0.0, c@1.0.0
 * - below-self-again-c@1.0.0 -> a@1.0.0
 * - b@2.0.0, b@3.0.0, c@2.0.0 have no dependencies
 *
 * The second a@1.0.0 sits below a@2.0.0's b@3.0.0, so its b@1.0.0 is nested
 * again, and that one's a@2.0.0 and b@3.0.0 after it. The layout ends there
 * because c@1.0.0 is then found without a conflict.
 *
 * self-contained-plugin / self-contained-peer-plugin: depend (the second one
 * through a peer dependency) on `self-contained-app@1.0.0`, which the tests
 * provide as a workspace.
 *
 * Every package exports `edges()`, which resolves each of its dependencies
 * from its own location and returns the versions it found.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const indexJs = `exports.edges = () => {
  const { dependencies = {}, peerDependencies = {} } = require("./package.json");
  return Object.fromEntries(
    Object.keys({ ...dependencies, ...peerDependencies }).map(name => [name, require(name + "/package.json").version]),
  );
};
`;

const one = "below-self-";
const two = "below-self-again-";

const packages: Record<string, Manifest[]> = {
  [`${one}a`]: [
    { version: "1.0.0", dependencies: { [`${one}b`]: "1.0.0", [`${one}e`]: "1.0.0" } },
    { version: "2.0.0", dependencies: { [`${one}c`]: "1.0.0", [`${one}e`]: "3.0.0" } },
  ],
  [`${one}b`]: [{ version: "1.0.0", dependencies: { [`${one}a`]: "2.0.0" } }, { version: "2.0.0" }],
  [`${one}c`]: [{ version: "1.0.0", dependencies: { [`${one}a`]: "1.0.0" } }, { version: "2.0.0" }],
  [`${one}e`]: [{ version: "1.0.0" }, { version: "2.0.0" }, { version: "3.0.0" }],

  [`${two}a`]: [
    { version: "1.0.0", dependencies: { [`${two}b`]: "1.0.0" } },
    { version: "2.0.0", dependencies: { [`${two}b`]: "3.0.0", [`${two}c`]: "1.0.0" } },
  ],
  [`${two}b`]: [
    { version: "1.0.0", dependencies: { [`${two}a`]: "2.0.0" } },
    { version: "2.0.0" },
    { version: "3.0.0" },
  ],
  [`${two}c`]: [{ version: "1.0.0", dependencies: { [`${two}a`]: "1.0.0" } }, { version: "2.0.0" }],

  "self-contained-plugin": [{ version: "1.0.0", dependencies: { "self-contained-app": "1.0.0" } }],
  "self-contained-peer-plugin": [{ version: "1.0.0", peerDependencies: { "self-contained-app": "1.0.0" } }],
};

for (const [name, manifests] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const versions: Record<string, object> = {};
  let latest = "";
  for (const manifest of manifests) {
    const pkgJson = { name, ...manifest };
    const tarball = join(dir, `${name}-${manifest.version}.tgz`);
    await Bun.Archive.write(
      tarball,
      { "package/package.json": JSON.stringify(pkgJson, null, 2), "package/index.js": indexJs },
      { compress: "gzip" },
    );

    const bytes = await Bun.file(tarball).bytes();
    versions[manifest.version] = {
      ...pkgJson,
      _id: `${name}@${manifest.version}`,
      dist: {
        integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${name}-${manifest.version}.tgz`,
      },
    };
    latest = manifest.version;
  }

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions }, null, 2),
  );
}

console.log("Created hoist below-self test packages");
