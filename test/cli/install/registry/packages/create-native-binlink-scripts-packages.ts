#!/usr/bin/env bun
/**
 * Generates the fixture package for the native binlink tests in which the platform package does not
 * stand in for the lifecycle scripts, so they have to run:
 *
 * - test-native-binlink-scripts@1.0.0
 *     bin shim + postinstall that writes a `postinstall-ran` marker
 *     optionalDependencies: test-native-binlink-target@1.0.0, which does not ship that bin
 * - test-native-binlink-scripts@2.0.0
 *     the same postinstall and platform package, and no bin
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;
const name = "test-native-binlink-scripts";

const postinstall = `node -e "require('fs').writeFileSync(require('path').join(__dirname,'postinstall-ran'),'')"`;

const shim = `#!/usr/bin/env node
console.log("shim v" + require("../package.json").version);
`;

const versions: Record<string, object> = {};
for (const [version, bin] of [
  ["1.0.0", { "scripts-test-cmd": "./bin/cmd.js" }],
  ["2.0.0", undefined],
] as const) {
  const pkgJson = {
    name,
    version,
    bin,
    scripts: { postinstall },
    optionalDependencies: { "test-native-binlink-target": "1.0.0" },
  };
  const filename = `${name}-${version}.tgz`;
  const tarball = join(packagesDir, name, filename);
  await mkdir(join(packagesDir, name), { recursive: true });
  await Bun.Archive.write(
    tarball,
    {
      "package/package.json": JSON.stringify(pkgJson, null, 2),
      ...(bin ? { "package/bin/cmd.js": shim } : {}),
    },
    { compress: "gzip" },
  );

  const bytes = await Bun.file(tarball).arrayBuffer();
  versions[version] = {
    ...pkgJson,
    _id: `${name}@${version}`,
    _hasInstallScript: true,
    hasInstallScript: true,
    dist: {
      integrity: `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`,
      shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
      tarball: `http://localhost:4873/${name}/-/${filename}`,
    },
  };
}

await writeFile(
  join(packagesDir, name, "package.json"),
  JSON.stringify({ _id: name, name, "dist-tags": { latest: "2.0.0" }, versions }, null, 2),
);

console.log("✅ Created native binlink scripts test packages");
