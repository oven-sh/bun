// https://github.com/oven-sh/bun/issues/28959
//
// pnpm records the registry-specific tarball URL inside `resolution.tarball`
// (GitHub Packages serves `/download/...` rather than the npm `/-/<name>-<ver>.tgz`
// layout). The migration from `pnpm-lock.yaml` to `bun.lock` must preserve that
// URL; otherwise bun tries to fetch a non-existent npm-shaped path and the
// install eventually hangs.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import fs from "node:fs";
import { join } from "node:path";

test("pnpm migration preserves resolution.tarball for GitHub Packages URLs", async () => {
  const githubTarball = "https://npm.pkg.github.com/download/@scope/pkg/0.2.0/0123456789abcdef0123456789abcdef01234567";

  const dir = tempDirWithFiles("issue-28959-pnpm-tarball", {
    "package.json": JSON.stringify({
      name: "issue-28959",
      version: "0.0.0",
      dependencies: {
        "@scope/pkg": "^0.2.0",
      },
    }),
    "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@scope/pkg':
        specifier: ^0.2.0
        version: 0.2.0

packages:

  '@scope/pkg@0.2.0':
    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==, tarball: ${githubTarball}}

snapshots:

  '@scope/pkg@0.2.0': {}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "migrate"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
  expect(exitCode).toBe(0);

  const bunLock = fs.readFileSync(join(String(dir), "bun.lock"), "utf8");

  // The tarball URL from pnpm's resolution must appear verbatim in the
  // migrated bun.lock (second field of the package entry).
  expect(bunLock).toContain(githubTarball);

  // And bun must NOT have fabricated an npm-shaped URL that GitHub Packages
  // doesn't recognize.
  expect(bunLock).not.toContain("@scope/pkg/-/pkg-0.2.0.tgz");
});
