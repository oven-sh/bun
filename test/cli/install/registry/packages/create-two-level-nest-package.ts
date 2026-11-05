#!/usr/bin/env bun
/**
 * Generates the `two-level-nest` fixture used by bun-install-registry.test.ts.
 *
 * - two-level-nest@1.0.0 -> one-fixed-dep@1.0.0, no-deps@1.1.0
 * - one-fixed-dep@1.0.0  -> no-deps@1.0.0 (existing fixture)
 *
 * Installed next to root dependencies one-fixed-dep@2.0.0 and no-deps@2.0.0,
 * both of its dependencies nest inside it, and one-fixed-dep@1.0.0's no-deps
 * can't use either no-deps above it, so it nests one level further down:
 *
 *   node_modules/two-level-nest/node_modules/one-fixed-dep            @1.0.0
 *   node_modules/two-level-nest/node_modules/no-deps                  @1.1.0
 *   node_modules/two-level-nest/node_modules/one-fixed-dep/node_modules/no-deps  @1.0.0
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const name = "two-level-nest";
const version = "1.0.0";
const dir = join(import.meta.dir, name);
await mkdir(dir, { recursive: true });

const pkgJson = { name, version, dependencies: { "one-fixed-dep": "1.0.0", "no-deps": "1.1.0" } };
const tarball = join(dir, `${name}-${version}.tgz`);
await Bun.Archive.write(tarball, { "package/package.json": JSON.stringify(pkgJson, null, 2) }, { compress: "gzip" });

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

console.log(`Created ${name} test package`);
