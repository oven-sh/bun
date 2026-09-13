import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The root lockfile is installed on a fresh runner by every PR's GitHub Actions
// checks (lint.yml, format.yml, rust-lints.yml, bun-types.yml) and by every
// build; test/ is installed by bun-types.yml and, together with root, by every
// Buildkite test shard. A package in either that resolves to something other
// than the npm registry puts a second host on the critical path of all of
// those jobs: the root `bun-tracestrings` github: dependency used to turn every
// GitHub tarball hiccup into "failed to download bun-tracestrings@github:...:
// HTTP 5xx" on unrelated PRs' Lint and Format checks. bun retries a tarball a
// few times back to back, which does not cover an outage of a few minutes, and
// fresh runners have no install cache to fall back on.
//
// That dependency now lives in scripts/ci-remap-server/, whose only consumer is
// scripts/runner.node.mjs (installed best-effort, from the cache bootstrap.sh
// bakes into the agent images). Anything else that needs a package not on the
// registry belongs in a package.json of its own like that one, not in these.
const lockfiles = ["bun.lock", "test/bun.lock"];

// Each lockfile entry starts with "name@resolution"; a scoped name contains a
// "/" but only the leading "@". The registry resolves to exactly a version
// (optionally with a prerelease or build suffix), and root:, workspace:, file:
// and link: are followed by a path to something already on disk. Everything
// else fails: github:, git+<url> and tarball URLs are fetched from another
// host, and a shape this does not know needs someone to decide which it is.
const registryOrLocal = /^@?[^@]+@(\d+\.\d+\.\d+([-+][\w.+-]*)?$|root:|workspace:|file:|link:)/;

test("registryOrLocal accepts registry versions and on-disk resolutions only", () => {
  const classified = Object.fromEntries(
    [
      "esbuild@0.21.5",
      "@types/node@25.0.0",
      "@wolfy1339/lru-cache@11.0.2-patch.1",
      "verdaccio@6.0.0-6-next.76",
      "bun@root:",
      "bun-types@workspace:packages/bun-types",
      "bun-plugin-svelte@file:../packages/bun-plugin-svelte",
      "react@link:../node_modules/react",
      "bun-tracestrings@github:oven-sh/bun.report#912ca63",
      "foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc",
      "foo@git+https://github.com/oven-sh/foo.git#0123abc",
      "foo@https://example.com/foo-1.0.0.tgz",
      "foo@1.2.3.tgz",
      "foo@1.2.3@github:oven-sh/foo",
      "foo@",
      "no-resolution",
    ].map(entry => [entry, registryOrLocal.test(entry)]),
  );
  expect(classified).toEqual({
    "esbuild@0.21.5": true,
    "@types/node@25.0.0": true,
    "@wolfy1339/lru-cache@11.0.2-patch.1": true,
    "verdaccio@6.0.0-6-next.76": true,
    "bun@root:": true,
    "bun-types@workspace:packages/bun-types": true,
    "bun-plugin-svelte@file:../packages/bun-plugin-svelte": true,
    "react@link:../node_modules/react": true,
    "bun-tracestrings@github:oven-sh/bun.report#912ca63": false,
    "foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc": false,
    "foo@git+https://github.com/oven-sh/foo.git#0123abc": false,
    "foo@https://example.com/foo-1.0.0.tgz": false,
    "foo@1.2.3.tgz": false,
    "foo@1.2.3@github:oven-sh/foo": false,
    "foo@": false,
    "no-resolution": false,
  });
});

test.each(lockfiles)("%s resolves every package from the npm registry", lockfile => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const lock = Bun.JSONC.parse(readFileSync(path.join(repoRoot, lockfile), "utf8")) as {
    packages: Record<string, [string, ...unknown[]]>;
  };

  const entries = Object.entries(lock.packages);
  // Guards against a lockfile layout change making the check below vacuous.
  expect(entries.length).toBeGreaterThan(0);

  const violations = entries
    .filter(([, [nameAtResolution]]) => !registryOrLocal.test(nameAtResolution))
    .map(([key, [nameAtResolution]]) => `${key} -> ${nameAtResolution}`);
  expect(violations).toEqual([]);
});
