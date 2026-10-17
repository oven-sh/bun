#!/usr/bin/env bun
/**
 * Generates the `typed-peer` fixtures used by isolated-install.test.ts.
 *
 * `typed-peer` ships no declaration file: its types come from `@types/typed-peer`, whose
 * versions declare `value` as a different type. `typed-peer-lib` peers on `typed-peer` and its
 * declaration file imports it, so the type of `takes` depends on which `@types/typed-peer`
 * TypeScript finds next to the library. `depends-on-old-typed-peer` depends on the library and
 * on the older `@types/typed-peer`. `depends-on-typed-peer-lib` depends on the library alone.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  name: string;
  version: string;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function createPackage(manifest: Manifest, files: Record<string, string>) {
  const { name, version } = manifest;
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const tarball = join(dir, `${name.replace("@types/", "")}-${version}.tgz`);
  await Bun.Archive.write(
    tarball,
    Object.fromEntries(
      Object.entries({ "package.json": JSON.stringify(manifest, null, 2), ...files }).map(([path, content]) => [
        `package/${path}`,
        content,
      ]),
    ),
    { compress: "gzip" },
  );

  const bytes = await Bun.file(tarball).bytes();
  return {
    ...manifest,
    _id: `${name}@${version}`,
    dist: {
      integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
      shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
      tarball: `http://localhost:4873/${name}/-/${name}-${version}.tgz`,
    },
  };
}

async function writeManifest(name: string, versions: Record<string, unknown>) {
  const latest = Object.keys(versions).at(-1)!;
  await writeFile(
    join(packagesDir, name, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions }, null, 2),
  );
}

{
  const name = "typed-peer";
  const versions: Record<string, unknown> = {};
  for (const [version, value] of [
    ["1.0.0", "1"],
    ["2.0.0", '"two"'],
  ]) {
    versions[version] = await createPackage(
      { name, version, main: "index.js" },
      { "index.js": `module.exports = { value: ${value} };\n` },
    );
  }
  await writeManifest(name, versions);
}

{
  const name = "@types/typed-peer";
  const versions: Record<string, unknown> = {};
  for (const [version, type] of [
    ["1.0.0", "number"],
    ["2.0.0", "string"],
  ]) {
    versions[version] = await createPackage(
      { name, version, types: "index.d.ts" },
      { "index.d.ts": `export declare const value: ${type};\n` },
    );
  }
  await writeManifest(name, versions);
}

{
  const name = "typed-peer-lib";
  const version = "1.0.0";
  await writeManifest(name, {
    [version]: await createPackage(
      { name, version, main: "index.js", types: "index.d.ts", peerDependencies: { "typed-peer": "*" } },
      {
        "index.js": `module.exports = { takes(v) { return require("typed-peer").value === v; } };\n`,
        "index.d.ts": `import { value } from "typed-peer";\nexport declare function takes(v: typeof value): boolean;\n`,
      },
    ),
  });
}

{
  const name = "depends-on-old-typed-peer";
  const version = "1.0.0";
  await writeManifest(name, {
    [version]: await createPackage(
      {
        name,
        version,
        main: "index.js",
        types: "index.d.ts",
        dependencies: { "@types/typed-peer": "1.0.0", "typed-peer-lib": "1.0.0" },
      },
      {
        "index.js": `module.exports = require("typed-peer-lib");\n`,
        "index.d.ts": `export { takes } from "typed-peer-lib";\n`,
      },
    ),
  });
}

{
  const name = "depends-on-typed-peer-lib";
  const version = "1.0.0";
  await writeManifest(name, {
    [version]: await createPackage(
      { name, version, main: "index.js", types: "index.d.ts", dependencies: { "typed-peer-lib": "1.0.0" } },
      {
        "index.js": `module.exports = require("typed-peer-lib");\n`,
        "index.d.ts": `export { takes } from "typed-peer-lib";\n`,
      },
    ),
  });
}

console.log("Created typed-peer test packages");
