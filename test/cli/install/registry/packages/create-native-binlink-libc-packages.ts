#!/usr/bin/env bun
/**
 * Creates the packages for the libc half of the native binlink tests
 * (bun-install-native-binlink.test.ts). Same shape as create-native-binlink-packages.ts,
 * except that the main package has two platform packages that only differ in `libc`:
 * - test-native-binlink-libc: main package, its bin exits with code 1
 * - test-native-binlink-libc-glibc: `libc: ["glibc"]`, its bin prints its own name and exits 0
 * - test-native-binlink-libc-musl: `libc: ["musl"]`, same
 */

import { $ } from "bun";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;
const version = "1.0.0";
const main = "test-native-binlink-libc";
const variants = { [`${main}-glibc`]: "glibc", [`${main}-musl`]: "musl" };

function manifest(name: string) {
  if (name === main) {
    return {
      bin: { "test-binlink-libc-cmd": "./bin/main.js" },
      optionalDependencies: Object.fromEntries(Object.keys(variants).map(variant => [variant, version])),
    };
  }
  return { os: ["darwin", "linux", "win32"], cpu: ["arm64", "x64"], libc: [variants[name]] };
}

for (const name of [main, ...Object.keys(variants)]) {
  const tmp = join(packagesDir, `${name}-tmp`);
  const pkg = join(tmp, "package");
  await mkdir(join(pkg, "bin"), { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name, version, ...manifest(name) }, null, 2));
  await writeFile(
    join(pkg, "bin", "main.js"),
    name === main
      ? `#!/usr/bin/env node\nconsole.log("ERROR: Using main package bin, not the libc-specific one!");\nprocess.exit(1);\n`
      : `#!/usr/bin/env node\nconsole.log("SUCCESS: Using ${name}");\nprocess.exit(0);\n`,
  );

  const tarballName = `${name}-${version}.tgz`;
  await mkdir(join(packagesDir, name), { recursive: true });
  const tarballPath = join(packagesDir, name, tarballName);
  await $`tar --owner=0 --group=0 --numeric-owner --mtime=1985-10-26T08:15:00Z -czf ${tarballPath} -C ${tmp} package`;
  await rm(tmp, { recursive: true });

  const tarball = await Bun.file(tarballPath).bytes();
  const integrity = `sha512-${Buffer.from(new Bun.CryptoHasher("sha512").update(tarball).digest()).toString("base64")}`;
  const shasum = Buffer.from(new Bun.CryptoHasher("sha1").update(tarball).digest()).toString("hex");

  await writeFile(
    join(packagesDir, name, "package.json"),
    JSON.stringify(
      {
        _id: name,
        name,
        "dist-tags": { latest: version },
        versions: {
          [version]: {
            name,
            version,
            _id: `${name}@${version}`,
            ...manifest(name),
            dist: { integrity, shasum, tarball: `http://localhost:4873/${name}/-/${tarballName}` },
          },
        },
      },
      null,
      2,
    ),
  );
}

console.log("Created native binlink libc test packages");
