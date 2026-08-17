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
// "/" but only the leading "@". Registry packages resolve to a bare version and
// the local kinds to root:, workspace:, file: or link:. Everything bun fetches
// from somewhere else is github:, git+<url> or a tarball URL.
function isOffRegistry(nameAtResolution: string): boolean {
  const resolution = /^@?[^@]+@(.*)$/s.exec(nameAtResolution)?.[1];
  // An entry this cannot split is a format change; flag it rather than skip it.
  return resolution === undefined || /^(github:|git\+|https?:\/\/)/.test(resolution);
}

test("isOffRegistry tells registry and local resolutions from fetched ones", () => {
  const classified = Object.fromEntries(
    [
      "esbuild@0.21.5",
      "@types/node@25.0.0",
      "bun@root:",
      "bun-types@workspace:packages/bun-types",
      "bun-plugin-svelte@file:../packages/bun-plugin-svelte",
      "react@link:../node_modules/react",
      "bun-tracestrings@github:oven-sh/bun.report#912ca63",
      "foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc",
      "foo@git+https://github.com/oven-sh/foo.git#0123abc",
      "foo@https://example.com/foo-1.0.0.tgz",
      "no-resolution",
    ].map(entry => [entry, isOffRegistry(entry)]),
  );
  expect(classified).toEqual({
    "esbuild@0.21.5": false,
    "@types/node@25.0.0": false,
    "bun@root:": false,
    "bun-types@workspace:packages/bun-types": false,
    "bun-plugin-svelte@file:../packages/bun-plugin-svelte": false,
    "react@link:../node_modules/react": false,
    "bun-tracestrings@github:oven-sh/bun.report#912ca63": true,
    "foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc": true,
    "foo@git+https://github.com/oven-sh/foo.git#0123abc": true,
    "foo@https://example.com/foo-1.0.0.tgz": true,
    "no-resolution": true,
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
    .filter(([, [nameAtResolution]]) => isOffRegistry(nameAtResolution))
    .map(([key, [nameAtResolution]]) => `${key} -> ${nameAtResolution}`);
  expect(violations).toEqual([]);
});
