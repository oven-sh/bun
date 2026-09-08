#!/usr/bin/env bun
// Generates the `lifecycle-blocking` / `lifecycle-blocking-parent` fixtures used by
// bun-install-lifecycle-scripts.test.ts ("an install that stops before a dependency's
// lifecycle scripts finish ...").
//
// `lifecycle-blocking`'s postinstall appends a line to $LIFECYCLE_TEST_LOG. With
// $LIFECYCLE_TEST_BLOCK set it then writes its pid to that path and never exits, so the
// test can kill `bun install` while the script runs. Without it, it writes `built.txt`.
// `lifecycle-blocking-parent` depends on it and writes its own `built.txt`.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const blockingPostinstall = `const { appendFileSync, renameSync, writeFileSync } = require("fs");

if (process.env.LIFECYCLE_TEST_LOG) {
  appendFileSync(process.env.LIFECYCLE_TEST_LOG, "lifecycle-blocking\\n");
}

const pidFile = process.env.LIFECYCLE_TEST_BLOCK;
if (pidFile) {
  writeFileSync(pidFile + ".tmp", String(process.pid));
  renameSync(pidFile + ".tmp", pidFile);
  setInterval(() => {}, 1 << 30);
} else {
  writeFileSync("built.txt", "built");
}
`;

const parentPostinstall = `const { appendFileSync, writeFileSync } = require("fs");

if (process.env.LIFECYCLE_TEST_LOG) {
  appendFileSync(process.env.LIFECYCLE_TEST_LOG, "lifecycle-blocking-parent\\n");
}
writeFileSync("built.txt", "built");
`;

type Fixture = {
  manifest: Record<string, unknown>;
  files: Record<string, string>;
};

const packages: Record<string, Fixture> = {
  "lifecycle-blocking": {
    manifest: { version: "1.0.0", scripts: { postinstall: "bun postinstall.js" } },
    files: { "postinstall.js": blockingPostinstall },
  },
  "lifecycle-blocking-parent": {
    manifest: {
      version: "1.0.0",
      dependencies: { "lifecycle-blocking": "1.0.0" },
      scripts: { postinstall: "bun postinstall.js" },
    },
    files: { "postinstall.js": parentPostinstall },
  },
};

for (const [name, { manifest, files }] of Object.entries(packages)) {
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const version = manifest.version as string;
  const pkgJson = { name, ...manifest };
  const tarball = join(dir, `${name}-${version}.tgz`);
  const entries: Record<string, string> = { "package/package.json": JSON.stringify(pkgJson, null, 2) };
  for (const [file, contents] of Object.entries(files)) {
    entries[`package/${file}`] = contents;
  }
  await Bun.Archive.write(tarball, entries, { compress: "gzip" });

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

console.log("Created lifecycle-blocking and lifecycle-blocking-parent test packages");
