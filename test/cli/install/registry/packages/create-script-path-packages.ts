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
 * - script-path-tool            `bin`: `script-path-tool`, which writes its
 *                               version to `tool.txt`. 1.0.0 and 2.0.0.
 * - script-path-uses-tool       Depends on script-path-tool and runs
 *                               `script-path-tool` in `postinstall`.
 * - script-path-self            `bin`: `script-path-self`, which writes
 *                               `self.txt`. Its `postinstall` runs it.
 * - script-path-bunx            `postinstall` runs `bun x script-path-tool`.
 *                               It does not depend on script-path-tool.
 * - script-path-node-gyp        `bin`: `node-gyp` at `bin/node-gyp.js`, the
 *                               layout of the real node-gyp. It writes
 *                               `pinned.txt`.
 * - script-path-gyp             Ships a `binding.gyp` and no `node-gyp`
 *                               dependency, so `node-gyp rebuild` runs through
 *                               bun's `node-gyp` shim.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;
const version = "1.0.0";

const plant = `#!/bin/sh\necho "\${0##*/}" >> planted.txt\n`;

const tool = (toolVersion: string) => ({
  version: toolVersion,
  pkgJson: {
    name: "script-path-tool",
    bin: { "script-path-tool": "tool.js" },
  },
  files: {
    "tool.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("tool.txt", "script-path-tool@${toolVersion}\\n");\n`,
  },
});

const packages: {
  pkgJson: Record<string, unknown> & { name: string };
  files?: Record<string, string>;
  version?: string;
}[] = [
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
  tool("1.0.0"),
  tool("2.0.0"),
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
    pkgJson: {
      name: "script-path-bunx",
      scripts: { postinstall: "bun x --silent script-path-tool" },
    },
  },
  {
    pkgJson: {
      name: "script-path-node-gyp",
      bin: { "node-gyp": "bin/node-gyp.js" },
    },
    files: {
      "bin/node-gyp.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("pinned.txt", "script-path-node-gyp@${version}\\n");\n`,
    },
  },
  {
    pkgJson: { name: "script-path-gyp" },
    files: { "binding.gyp": "" },
  },
];

const packuments = new Map<string, { latest: string; versions: Record<string, object> }>();
for (const { pkgJson, files = {}, version: packageVersion = version } of packages) {
  const { name } = pkgJson;
  const manifest = { ...pkgJson, version: packageVersion };
  const dir = join(packagesDir, name);
  await mkdir(dir, { recursive: true });

  const entries: Record<string, string> = { "package/package.json": JSON.stringify(manifest, null, 2) };
  for (const [path, content] of Object.entries(files)) {
    entries[`package/${path}`] = content;
  }

  const tarball = join(dir, `${name}-${packageVersion}.tgz`);
  await Bun.Archive.write(tarball, entries, { compress: "gzip" });

  const bytes = await Bun.file(tarball).bytes();
  const packument = packuments.get(name) ?? { latest: packageVersion, versions: {} };
  packument.latest = packageVersion;
  packument.versions[packageVersion] = {
    ...manifest,
    _id: `${name}@${packageVersion}`,
    dist: {
      integrity: `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(bytes).digest()).toString("base64")}`,
      shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
      tarball: `http://localhost:4873/${name}/-/${name}-${packageVersion}.tgz`,
    },
  };
  packuments.set(name, packument);
}

for (const [name, { latest, versions }] of packuments) {
  await writeFile(
    join(packagesDir, name, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions }, null, 2),
  );
}

console.log("Created script-path test packages");
