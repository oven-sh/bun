#!/usr/bin/env bun
/**
 * Fixture packages for the native-binlink "altpath" probe: the parent
 * package's `bin` points at a stub path that doesn't exist in the platform
 * optionalDependency, so the redirect has to probe alternate locations inside
 * the platform package.
 *
 * Each version exercises a different probe in `bin::Linker::resolve_bin_target`:
 *   1.0.0  parent bin `bin/altpath-cmd.exe`, target ships `altpath-cmd` at root
 *          → probe 2, `<pkg>/<bin_name>` (claude-code-linux-* shape)
 *   2.0.0  parent bin `bin/launcher.exe`, target ships `launcher.exe` at root
 *          → probe 3, `<pkg>/<basename(target)>` (bin key ≠ target stem so
 *          probe 4's `<bin_name>.exe` misses; isolates probe 3)
 *   3.0.0  parent bin `bin/altpath-cmd`, target ships `altpath-cmd.exe` at root
 *          → probe 4, `<pkg>/<bin_name>.exe` (@esbuild/win32-* shape)
 *   4.0.0  parent bin is an 8 KiB value that does not fit the path buffer on
 *          Linux or macOS (so probe 1 cannot even be built, and no stub is
 *          packed for it), target ships `altpath-cmd` at root → probe 2
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

async function packTarball(pkgName: string, version: string, pkgJson: object, files: Record<string, string>) {
  const outDir = join(packagesDir, pkgName);
  await mkdir(outDir, { recursive: true });
  const tarball = join(outDir, `${pkgName}-${version}.tgz`);
  const entries: Record<string, string> = {
    "package/package.json": JSON.stringify(pkgJson, null, 2),
  };
  for (const [rel, contents] of Object.entries(files)) entries[`package/${rel}`] = contents;
  await Bun.Archive.write(tarball, entries, { compress: "gzip" });
  return tarball;
}

async function integrity(tarball: string) {
  const bytes = await Bun.file(tarball).arrayBuffer();
  const sha512 = new Bun.CryptoHasher("sha512").update(bytes).digest();
  const sha1 = new Bun.CryptoHasher("sha1").update(bytes).digest();
  return {
    integrity: `sha512-${Buffer.from(sha512).toString("base64")}`,
    shasum: Buffer.from(sha1).toString("hex"),
  };
}

const postinstall = `node -e "require('fs').writeFileSync(require('path').join(__dirname,'postinstall-ran'),'')"`;

// A stub that crashes if it's ever linked (it has no shebang, mirroring the
// real claude-code stub that postinstall is meant to overwrite).
const stub = `echo "ERROR: native binary not installed" >&2
exit 1
`;

const nativeBin = `#!/usr/bin/env node
console.log("SUCCESS: Using platform-specific bin at package root");
process.exit(0);
`;

const longBinValue = "bin/" + Buffer.alloc(8192, "b").toString();

const shapes = [
  { version: "1.0.0", parentBinValue: "bin/altpath-cmd.exe", targetFile: "altpath-cmd" },
  { version: "2.0.0", parentBinValue: "bin/launcher.exe", targetFile: "launcher.exe" },
  { version: "3.0.0", parentBinValue: "bin/altpath-cmd", targetFile: "altpath-cmd.exe" },
  { version: "4.0.0", parentBinValue: longBinValue, targetFile: "altpath-cmd" },
] as const;

const parentVersions: Record<string, { tarball: string; pkgJson: object }> = {};
const targetVersions: Record<string, { tarball: string; pkgJson: object }> = {};

for (const { version, parentBinValue, targetFile } of shapes) {
  const parentJson = {
    name: "test-native-binlink-altpath",
    version,
    bin: { "altpath-cmd": parentBinValue },
    scripts: { postinstall },
    optionalDependencies: { "test-native-binlink-altpath-target": version },
  };
  parentVersions[version] = {
    pkgJson: parentJson,
    tarball: await packTarball(
      "test-native-binlink-altpath",
      version,
      parentJson,
      parentBinValue === longBinValue ? {} : { [parentBinValue]: stub },
    ),
  };

  const targetJson = {
    name: "test-native-binlink-altpath-target",
    version,
    os: ["darwin", "linux", "win32"],
    cpu: ["arm64", "x64"],
  };
  targetVersions[version] = {
    pkgJson: targetJson,
    tarball: await packTarball("test-native-binlink-altpath-target", version, targetJson, {
      [targetFile]: nativeBin,
    }),
  };
}

async function writeManifest(pkgName: string, versions: Record<string, { tarball: string; pkgJson: object }>) {
  const versionsObj: Record<string, object> = {};
  let latest = "";
  for (const [v, { tarball, pkgJson }] of Object.entries(versions)) {
    const dist = await integrity(tarball);
    versionsObj[v] = {
      ...pkgJson,
      _id: `${pkgName}@${v}`,
      _hasInstallScript: (pkgJson as any).scripts?.postinstall ? true : undefined,
      hasInstallScript: (pkgJson as any).scripts?.postinstall ? true : undefined,
      dist: {
        ...dist,
        tarball: `http://localhost:4873/${pkgName}/-/${pkgName}-${v}.tgz`,
      },
    };
    latest = v;
  }
  await writeFile(
    join(packagesDir, pkgName, "package.json"),
    JSON.stringify({ _id: pkgName, name: pkgName, "dist-tags": { latest }, versions: versionsObj }, null, 2),
  );
}

await writeManifest("test-native-binlink-altpath", parentVersions);
await writeManifest("test-native-binlink-altpath-target", targetVersions);

console.log("✅ Created native-binlink altpath test packages");
