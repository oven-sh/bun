#!/usr/bin/env bun
/**
 * This script creates test packages for native binlink optimization testing
 * with a scoped main package (`node_modules/@scope/name` nests one directory
 * level deeper, which the installed-package binlink resolution must handle).
 * It creates:
 * - @binlink-scope/test-native-binlink: main package with a bin that exits with code 1
 * - test-native-binlink-scoped-target: platform-specific package with bin that exits with code 0
 */

import { $ } from "bun";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

const scope = "@binlink-scope";
const mainName = `${scope}/test-native-binlink`;
const targetName = "test-native-binlink-scoped-target";
const version = "1.0.0";

const mainPkgDir = join(packagesDir, "test-native-binlink-scoped-tmp");
const targetPkgDir = join(packagesDir, `${targetName}-tmp`);

try {
  // Main package that should NOT be used
  await mkdir(join(mainPkgDir, "package", "bin"), { recursive: true });

  await writeFile(
    join(mainPkgDir, "package", "package.json"),
    JSON.stringify(
      {
        name: mainName,
        version,
        bin: {
          "test-binlink-scoped-cmd": "./bin/main.js",
        },
        optionalDependencies: {
          [targetName]: version,
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(mainPkgDir, "package", "bin", "main.js"),
    `#!/usr/bin/env node
console.log("ERROR: Using main package bin, not platform-specific!");
process.exit(1);
`,
  );

  await mkdir(join(packagesDir, scope, "test-native-binlink"), { recursive: true });
  await $`cd ${mainPkgDir} && tar -czf ${join(packagesDir, scope, "test-native-binlink", `test-native-binlink-${version}.tgz`)} package`;

  // Platform-specific package
  await mkdir(join(targetPkgDir, "package", "bin"), { recursive: true });

  await writeFile(
    join(targetPkgDir, "package", "package.json"),
    JSON.stringify(
      {
        name: targetName,
        version,
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
      },
      null,
      2,
    ),
  );

  // Use the SAME filename as the main package!
  await writeFile(
    join(targetPkgDir, "package", "bin", "main.js"),
    `#!/usr/bin/env node
console.log("SUCCESS: Using platform-specific bin (${targetName})");
process.exit(0);
`,
  );

  await mkdir(join(packagesDir, targetName), { recursive: true });
  await $`cd ${targetPkgDir} && tar -czf ${join(packagesDir, targetName, `${targetName}-${version}.tgz`)} package`;

  // Create package.json for verdaccio registry with proper integrity hashes
  for (const [pkgName, pkgDir, tarballName] of [
    [mainName, join(packagesDir, scope, "test-native-binlink"), `test-native-binlink-${version}.tgz`],
    [targetName, join(packagesDir, targetName), `${targetName}-${version}.tgz`],
  ] as const) {
    const tarballBytes = await Bun.file(join(pkgDir, tarballName)).arrayBuffer();
    const hash = new Bun.CryptoHasher("sha512");
    hash.update(tarballBytes);
    const integrity = `sha512-${Buffer.from(hash.digest()).toString("base64")}`;

    const sha1Hash = new Bun.CryptoHasher("sha1");
    sha1Hash.update(tarballBytes);
    const shasum = Buffer.from(sha1Hash.digest()).toString("hex");

    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify(
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
              bin: pkgName === mainName ? { "test-binlink-scoped-cmd": "./bin/main.js" } : undefined,
              optionalDependencies:
                pkgName === mainName
                  ? {
                      [targetName]: version,
                    }
                  : undefined,
              os: pkgName === targetName ? ["darwin", "linux", "win32"] : undefined,
              cpu: pkgName === targetName ? ["arm64", "x64"] : undefined,
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
      )}\n`,
    );
  }
} finally {
  await Promise.all([
    rm(mainPkgDir, { recursive: true, force: true }),
    rm(targetPkgDir, { recursive: true, force: true }),
  ]);
}

console.log("✅ Created scoped native binlink test packages");
