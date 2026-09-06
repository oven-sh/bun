#!/usr/bin/env bun
/**
 * Generates fixture packages for the native-binary postinstall skip test:
 * a package that ships its binary via a platform optionalDependency, in two
 * versions so one ends up hoisted and the other nested, plus a parent that
 * pins the older version to force the nested placement.
 *
 * - test-postinstall-skip@1.0.0 / @2.0.0
 *     bin shim + postinstall that writes a `postinstall-ran` marker
 *     optionalDependencies: test-postinstall-skip-native@<same version>
 * - test-postinstall-skip-native@1.0.0 / @2.0.0
 *     os/cpu-gated package providing bin/cmd.js
 * - test-postinstall-skip-parent@1.0.0
 *     depends on test-postinstall-skip@1.0.0 (forces nested copy when root has 2.0.0)
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Files = Record<string, string>;

async function packTarball(pkgName: string, version: string, pkgJson: object, files: Files) {
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

const shim = `#!/usr/bin/env node
console.log("shim v" + require("../package.json").version);
`;

const nativeBin = (v: string) => `#!/usr/bin/env node
console.log("native v${v}");
`;

// test-postinstall-skip@1.0.0 and @2.0.0
const mainVersions: Record<string, { tarball: string; pkgJson: object }> = {};
for (const v of ["1.0.0", "2.0.0"]) {
  const pkgJson = {
    name: "test-postinstall-skip",
    version: v,
    bin: { "skip-test-cmd": "./bin/cmd.js" },
    scripts: { postinstall },
    optionalDependencies: { "test-postinstall-skip-native": v },
  };
  const tarball = await packTarball("test-postinstall-skip", v, pkgJson, {
    "bin/cmd.js": shim,
  });
  mainVersions[v] = { tarball, pkgJson };
}

// test-postinstall-skip-native@1.0.0 and @2.0.0
const nativeVersions: Record<string, { tarball: string; pkgJson: object }> = {};
for (const v of ["1.0.0", "2.0.0"]) {
  const pkgJson = {
    name: "test-postinstall-skip-native",
    version: v,
    os: ["darwin", "linux", "win32"],
    cpu: ["arm64", "x64"],
  };
  const tarball = await packTarball("test-postinstall-skip-native", v, pkgJson, {
    "bin/cmd.js": nativeBin(v),
  });
  nativeVersions[v] = { tarball, pkgJson };
}

// test-postinstall-skip-parent@1.0.0 and @2.0.0
// 1.0.0 depends only on skip@1.0.0 (native dep lands in the child tree under skip)
// 2.0.0 also depends on native@1.0.0 directly so native lands as a sibling of skip
const parentVersions: Record<string, { tarball: string; pkgJson: object }> = {};
for (const [v, deps] of [
  ["1.0.0", { "test-postinstall-skip": "1.0.0" }],
  ["2.0.0", { "test-postinstall-skip": "1.0.0", "test-postinstall-skip-native": "1.0.0" }],
] as const) {
  const pkgJson = { name: "test-postinstall-skip-parent", version: v, dependencies: deps };
  const tarball = await packTarball("test-postinstall-skip-parent", v, pkgJson, {});
  parentVersions[v] = { tarball, pkgJson };
}

// registry manifests
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
    JSON.stringify(
      {
        _id: pkgName,
        name: pkgName,
        "dist-tags": { latest },
        versions: versionsObj,
      },
      null,
      2,
    ),
  );
}

await writeManifest("test-postinstall-skip", mainVersions);
await writeManifest("test-postinstall-skip-native", nativeVersions);
await writeManifest("test-postinstall-skip-parent", parentVersions);

console.log("✅ Created postinstall-skip test packages");
