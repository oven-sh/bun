#!/usr/bin/env bun
// Generates the `simple-git-hooks` fixture used by bun-install-lifecycle-scripts.test.ts
// to check that the package is not on the default trusted dependencies list.
//
// The postinstall mirrors simple-git-hooks@2.13.1: it records that it ran, then
// reads the project's package.json two directories above its own install
// directory. With the isolated linker the package runs from
// node_modules/.bun/simple-git-hooks@2.13.1/node_modules/simple-git-hooks, so
// that stat throws ENOENT and the script exits non-zero.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const name = "simple-git-hooks";
const version = "2.13.1";

const pkgJson = {
  name,
  version,
  scripts: {
    postinstall: "bun postinstall.js",
  },
};

const postinstall = `const fs = require("fs");
fs.writeFileSync("postinstall-ran", "");
fs.statSync("../../package.json");
`;

const dir = join(import.meta.dir, name);
await mkdir(dir, { recursive: true });

const tarball = join(dir, `${name}-${version}.tgz`);
await Bun.Archive.write(
  tarball,
  {
    "package/package.json": JSON.stringify(pkgJson, null, 2),
    "package/postinstall.js": postinstall,
  },
  { compress: "gzip" },
);

const bytes = await Bun.file(tarball).bytes();
await writeFile(
  join(dir, "package.json"),
  JSON.stringify(
    {
      _id: name,
      name,
      "dist-tags": { latest: version },
      versions: {
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
      },
    },
    null,
    2,
  ),
);

console.log(`Created ${name}@${version} test package`);
