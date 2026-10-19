#!/usr/bin/env bun
// Generates test-native-binlink-scripts and its platform package for bun-install-native-binlink.test.ts.

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const marker = (name: string) =>
  `node -e "require('fs').writeFileSync(require('path').join(__dirname,'${name}-ran'),'')"`;
const preinstall = marker("preinstall");
const postinstall = marker("postinstall");

const script = (label: string) => `#!/usr/bin/env node
console.log("${label} v" + require("../package.json").version);
`;

type Version = { pkgJson: Record<string, unknown>; files: Record<string, string> };

const native = "test-native-binlink-scripts-native";
const optionalDependencies = { [native]: "1.0.0" };
const packages: Record<string, Record<string, Version>> = {
  [native]: {
    // Ships `bin/cmd.js`, and a `tools` folder with no file in it.
    "1.0.0": {
      pkgJson: { os: ["darwin", "linux", "win32"], cpu: ["arm64", "x64"] },
      files: {
        "bin/cmd.js": `#!/usr/bin/env node\nconsole.log("native");\n`,
        "tools/nested/keep.txt": "",
      },
    },
  },
  "test-native-binlink-scripts": {
    // The platform package does not ship this bin.
    "1.0.0": {
      pkgJson: {
        bin: { "scripts-test-cmd": "./bin/missing.js" },
        scripts: { preinstall, postinstall },
        optionalDependencies,
      },
      files: { "bin/missing.js": script("shim") },
    },
    "2.0.0": {
      pkgJson: { scripts: { postinstall }, optionalDependencies },
      files: {},
    },
    // The platform package ships one of the two bins.
    "3.0.0": {
      pkgJson: {
        bin: { "scripts-test-cmd": "./bin/cmd.js", "scripts-test-other": "./bin/other.js" },
        scripts: { postinstall },
        optionalDependencies,
      },
      files: { "bin/cmd.js": script("shim"), "bin/other.js": script("other") },
    },
    "4.0.0": {
      pkgJson: { directories: { bin: "./tools" }, scripts: { postinstall }, optionalDependencies },
      files: { "tools/scripts-test-tool": script("tool") },
    },
    // The platform package ships the bin.
    "5.0.0": {
      pkgJson: {
        bin: { "scripts-test-cmd": "./bin/cmd.js" },
        scripts: { preinstall, postinstall },
        optionalDependencies,
      },
      files: { "bin/cmd.js": script("shim") },
    },
  },
};

for (const [name, versions] of Object.entries(packages)) {
  await mkdir(join(packagesDir, name), { recursive: true });
  const manifest: Record<string, object> = {};
  let latest = "";
  for (const [version, { pkgJson, files }] of Object.entries(versions)) {
    const filename = `${name}-${version}.tgz`;
    const tarball = join(packagesDir, name, filename);
    const entries: Record<string, string> = {
      "package/package.json": JSON.stringify({ name, version, ...pkgJson }, null, 2),
    };
    for (const [path, contents] of Object.entries(files)) entries[`package/${path}`] = contents;
    await Bun.Archive.write(tarball, entries, { compress: "gzip" });

    const bytes = await Bun.file(tarball).arrayBuffer();
    const hasInstallScript = "scripts" in pkgJson ? true : undefined;
    manifest[version] = {
      name,
      version,
      ...pkgJson,
      _id: `${name}@${version}`,
      _hasInstallScript: hasInstallScript,
      hasInstallScript,
      dist: {
        integrity: `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`,
        shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
        tarball: `http://localhost:4873/${name}/-/${filename}`,
      },
    };
    latest = version;
  }
  await writeFile(
    join(packagesDir, name, "package.json"),
    JSON.stringify({ _id: name, name, "dist-tags": { latest }, versions: manifest }, null, 2),
  );
}

console.log("✅ Created native binlink scripts test packages");
