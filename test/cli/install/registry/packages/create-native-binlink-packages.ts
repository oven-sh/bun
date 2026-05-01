#!/usr/bin/env bun
/**
 * This script creates test packages for native binlink optimization testing.
 * It creates:
 * - test-native-binlink: main package with a bin that exits with code 1
 * - test-native-binlink-target: platform-specific package with bin that exits with code 0
 */

import { $ } from "bun";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

// Main package that should NOT be used
const mainPkgDir = join(packagesDir, "test-native-binlink-tmp");
await mkdir(mainPkgDir, { recursive: true });
await mkdir(join(mainPkgDir, "bin"), { recursive: true });

await writeFile(
  join(mainPkgDir, "package.json"),
  JSON.stringify(
    {
      name: "test-native-binlink",
      version: "1.0.0",
      bin: {
        "test-binlink-cmd": "./bin/main.js",
      },
      optionalDependencies: {
        "test-native-binlink-target": "1.0.0",
      },
    },
    null,
    2,
  ),
);

await writeFile(
  join(mainPkgDir, "bin", "main.js"),
  `#!/usr/bin/env node
console.log("ERROR: Using main package bin, not platform-specific!");
process.exit(1);
`,
);

// Create package structure for tarball
const mainTarDir = join(mainPkgDir, "package");
await mkdir(mainTarDir, { recursive: true });
await mkdir(join(mainTarDir, "bin"), { recursive: true });
await $`cp ${join(mainPkgDir, "package.json")} ${mainTarDir}/`;
await $`cp ${join(mainPkgDir, "bin", "main.js")} ${join(mainTarDir, "bin")}/`;

// Create tarball
await mkdir(join(packagesDir, "test-native-binlink"), { recursive: true });
await $`cd ${mainPkgDir} && tar -czf ${join(packagesDir, "test-native-binlink", "test-native-binlink-1.0.0.tgz")} package`;

// Platform-specific package
const targetPkgDir = join(packagesDir, "test-native-binlink-target-tmp");
await mkdir(targetPkgDir, { recursive: true });
await mkdir(join(targetPkgDir, "bin"), { recursive: true });

await writeFile(
  join(targetPkgDir, "package.json"),
  JSON.stringify(
    {
      name: "test-native-binlink-target",
      version: "1.0.0",
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
    },
    null,
    2,
  ),
);

// Use the SAME filename as the main package!
await writeFile(
  join(targetPkgDir, "bin", "main.js"),
  `#!/usr/bin/env node
console.log("SUCCESS: Using platform-specific bin (test-native-binlink-target)");
process.exit(0);
`,
);

// Create package structure for tarball
const targetTarDir = join(targetPkgDir, "package");
await mkdir(targetTarDir, { recursive: true });
await mkdir(join(targetTarDir, "bin"), { recursive: true });
await $`cp ${join(targetPkgDir, "package.json")} ${targetTarDir}/`;
await $`cp ${join(targetPkgDir, "bin", "main.js")} ${join(targetTarDir, "bin")}/`;

// Create tarball
await mkdir(join(packagesDir, "test-native-binlink-target"), { recursive: true });
await $`cd ${targetPkgDir} && tar -czf ${join(packagesDir, "test-native-binlink-target", "test-native-binlink-target-1.0.0.tgz")} package`;

// Create package.json for verdaccio registry with proper integrity hashes
for (const pkgName of ["test-native-binlink", "test-native-binlink-target"]) {
  const version = "1.0.0";
  const tarballName = `${pkgName}-${version}.tgz`;
  const tarballPath = join(packagesDir, pkgName, tarballName);

  // Calculate SHA512 integrity hash
  const tarballFile = Bun.file(tarballPath);
  const tarballBytes = await tarballFile.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha512");
  hash.update(tarballBytes);
  const integrity = `sha512-${Buffer.from(hash.digest()).toString("base64")}`;

  // Calculate SHA1 shasum
  const sha1Hash = new Bun.CryptoHasher("sha1");
  sha1Hash.update(tarballBytes);
  const shasum = Buffer.from(sha1Hash.digest()).toString("hex");

  await writeFile(
    join(packagesDir, pkgName, "package.json"),
    JSON.stringify(
      {
        _id: pkgName,
        name: pkgName,
        "dist-tags": {
          latest: version,
        },
        versions: {
          [version]: {
            name: pkgName,
            version,
            _id: `${pkgName}@${version}`,
            bin: pkgName === "test-native-binlink" ? { "test-binlink-cmd": "./bin/main.js" } : undefined,
            optionalDependencies:
              pkgName === "test-native-binlink"
                ? {
                    "test-native-binlink-target": "1.0.0",
                  }
                : undefined,
            os: pkgName === "test-native-binlink-target" ? ["darwin", "linux", "win32"] : undefined,
            cpu: pkgName === "test-native-binlink-target" ? ["arm64", "x64"] : undefined,
            dist: {
              integrity,
              shasum,
              tarball: `http://localhost:4873/${pkgName}/-/${tarballName}`,
            },
          },
        },
      },
      null,
      2,
    ),
  );
}

// Clean up temp directories
await $`rm -rf ${mainPkgDir}`;
await $`rm -rf ${targetPkgDir}`;

console.log("✅ Created native binlink test packages");
