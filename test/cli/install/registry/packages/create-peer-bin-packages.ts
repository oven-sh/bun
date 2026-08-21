#!/usr/bin/env bun
/**
 * Generates the fixtures used by the "resolved peer bins" tests in
 * isolated-install.test.ts (issue #39857). The isolated linker wires a
 * resolved peer only inside the store, so the peer's bin must still be
 * linked into the project root `node_modules/.bin` (pnpm does the same).
 *
 * - peer-what-bin@1.0.0            peerDependencies: { what-bin: "1.0.0" }
 * - optional-peer-what-bin@1.0.0   same, but optional via peerDependenciesMeta
 * - provides-optional-peer-what-bin@1.0.0
 *     -> optional-peer-what-bin@1.0.0, what-bin@1.0.0
 *     (a parent that provides the optional peer, like oxlint-tsgolint)
 */

import { $ } from "bun";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const packagesDir = import.meta.dir;

type Manifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: true }>;
};

const manifests: Manifest[] = [
  {
    name: "peer-what-bin",
    version: "1.0.0",
    peerDependencies: { "what-bin": "1.0.0" },
  },
  {
    name: "optional-peer-what-bin",
    version: "1.0.0",
    peerDependencies: { "what-bin": "1.0.0" },
    peerDependenciesMeta: { "what-bin": { optional: true } },
  },
  {
    name: "provides-optional-peer-what-bin",
    version: "1.0.0",
    dependencies: { "optional-peer-what-bin": "1.0.0", "what-bin": "1.0.0" },
  },
];

for (const manifest of manifests) {
  const { name, version } = manifest;
  const tmpDir = join(packagesDir, `${name}-tmp`);
  const tarDir = join(tmpDir, "package");
  await mkdir(tarDir, { recursive: true });
  await writeFile(join(tarDir, "package.json"), JSON.stringify(manifest, null, 2));

  const tarballName = `${name}-${version}.tgz`;
  await mkdir(join(packagesDir, name), { recursive: true });
  await $`cd ${tmpDir} && tar -czf ${join(packagesDir, name, tarballName)} package`;
  await rm(tmpDir, { recursive: true, force: true });

  const tarballBytes = await Bun.file(join(packagesDir, name, tarballName)).arrayBuffer();
  const sha512 = new Bun.CryptoHasher("sha512");
  sha512.update(tarballBytes);
  const integrity = `sha512-${Buffer.from(sha512.digest()).toString("base64")}`;
  const sha1 = new Bun.CryptoHasher("sha1");
  sha1.update(tarballBytes);
  const shasum = Buffer.from(sha1.digest()).toString("hex");

  await writeFile(
    join(packagesDir, name, "package.json"),
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
              integrity,
              shasum,
              tarball: `http://localhost:4873/${name}/-/${tarballName}`,
            },
          },
        },
      },
      null,
      2,
    ),
  );
}

console.log("Created peer bin test packages");
