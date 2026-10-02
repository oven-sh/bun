#!/usr/bin/env bun
/**
 * Generates the `script-path-*` fixtures used by the "lifecycle script PATH"
 * tests in bun-install-lifecycle-scripts.test.ts. Every script writes a `.txt`
 * file into its working directory, so a test can read which program ran.
 *
 * - script-path-plants          No lifecycle script. Its `bin` map claims the
 *                               names `node`, `bash`, `node-gyp`,
 *                               `script-path-tool` and `script-path-self`.
 *                               Each of them appends its own name to
 *                               `planted.txt`.
 * - script-path-carries-plants  Depends on script-path-plants, so that package
 *                               is a transitive dependency of the project.
 * - script-path-native          `preinstall` and `postinstall` run
 *                               `node build.js <hook>`, which appends the hook
 *                               name to `built.txt`.
 * - script-path-tool            `bin`: `script-path-tool`, which writes
 *                               `tool.txt`.
 * - script-path-uses-tool       Depends on script-path-tool and runs
 *                               `script-path-tool` in `postinstall`.
 * - script-path-self            `bin`: `script-path-self`, which writes
 *                               `self.txt`. Its `postinstall` runs it.
 * - script-path-gyp             Ships a `binding.gyp` and no `node-gyp`
 *                               dependency, so `node-gyp rebuild` runs through
 *                               bun's `node-gyp` shim.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;
const version = "1.0.0";

const plant = `#!/bin/sh\necho "\${0##*/}" >> planted.txt\n`;

const packages: { pkgJson: Record<string, unknown> & { name: string }; files?: Record<string, string> }[] = [
  {
    pkgJson: {
      name: "script-path-plants",
      bin: Object.fromEntries(
        ["node", "bash", "node-gyp", "script-path-tool", "script-path-self"].map(name => [name, "plant.sh"]),
      ),
    },
    files: { "plant.sh": plant },
  },
  {
    pkgJson: {
      name: "script-path-carries-plants",
      dependencies: { "script-path-plants": version },
    },
  },
  {
    pkgJson: {
      name: "script-path-native",
      scripts: { preinstall: "node build.js preinstall", postinstall: "node build.js postinstall" },
    },
    files: { "build.js": `require("fs").appendFileSync("built.txt", process.argv[2] + "\\n");\n` },
  },
  {
    pkgJson: {
      name: "script-path-tool",
      bin: { "script-path-tool": "tool.js" },
    },
    files: {
      "tool.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("tool.txt", "script-path-tool@${version}\\n");\n`,
    },
  },
  {
    pkgJson: {
      name: "script-path-uses-tool",
      scripts: { postinstall: "script-path-tool" },
      dependencies: { "script-path-tool": version },
    },
  },
  {
    pkgJson: {
      name: "script-path-self",
      bin: { "script-path-self": "self.js" },
      scripts: { postinstall: "script-path-self" },
    },
    files: {
      "self.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("self.txt", "script-path-self@${version}\\n");\n`,
    },
  },
  {
    pkgJson: { name: "script-path-gyp" },
    files: { "binding.gyp": "" },
  },
];

for (const { pkgJson, files = {} } of packages) {
  const { name } = pkgJson;
  const manifest = { ...pkgJson, version };
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const entries: Record<string, string> = { "package/package.json": JSON.stringify(manifest, null, 2) };
  for (const [path, content] of Object.entries(files)) {
    entries[`package/${path}`] = content;
  }

  const tarball = join(dir, `${name}-${version}.tgz`);
  await Bun.Archive.write(tarball, entries, { compress: "gzip" });

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
            ...manifest,
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
}

console.log("Created script-path test packages");
