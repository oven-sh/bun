import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// CI installs from the committed lockfiles on machines with no cache to fall
// back on: root on every PR's GitHub Actions checks (lint.yml, format.yml,
// rust-lints.yml, bun-types.yml), root + packages/bun-error + src/node-fallbacks
// on every build (scripts/build/codegen.ts), root + test/ on every Buildkite
// test shard. A package in one of them that downloads from anywhere but the npm
// registry puts a second host on the critical path of all of those jobs: the
// root `bun-tracestrings` github: dependency used to turn every GitHub tarball
// hiccup into "failed to download bun-tracestrings@github:...: HTTP 5xx" on
// unrelated PRs' Lint and Format checks, and bench/bun.lock was committed with
// two packages pointing at an internal mirror. bun retries a tarball a few times
// back to back, which does not cover an outage of a few minutes.
//
// So every committed bun.lock has to resolve everything from the registry or
// from disk, except the ones listed here with the reason. A package that needs
// to come from somewhere else gets a package.json of its own, installed only by
// whatever needs it, like scripts/ci-remap-server.
const allowedOffRegistry: Record<string, string> = {
  "scripts/ci-remap-server/bun.lock":
    "bun-tracestrings is github:oven-sh/bun.report; only scripts/runner.node.mjs installs it, best-effort, from the cache bootstrap.sh bakes into the agent images",
};

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function committedLockfiles(): string[] {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-files", "-z", "--", "bun.lock", "*/bun.lock"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git ls-files failed: ${r.stderr.toString()}`);
  return r.stdout.toString().split("\0").filter(Boolean);
}

/** One `packages` value. The layout per resolution kind (`npm -> ["name@version", registry, INFO, integrity]`, ...) is listed where src/install/lockfile/bun.lock.rs writes them. */
type Entry = [string, ...unknown[]];

// A registry package is written as exactly "name@version" (a scoped name has a
// "/" in it but only the leading "@") followed by its registry field: "" when
// bun wrote it for a tarball under registry.npmjs.org, otherwise the tarball URL
// verbatim, which the next install downloads from as-is (a hand-edited entry
// may spell the registry out; bun accepts that too). root:, workspace:, file:
// and link: point at something already on disk. Everything else downloads from
// another host (github:, git+<url>, a tarball URL in either position) or is a
// shape this does not know, and either way someone has to decide.
const registryVersion = /^@?[^@]+@\d+\.\d+\.\d+([-+][\w.+-]*)?$/;
const onDisk = /^@?[^@]+@(root:|workspace:|file:|link:)/;
const defaultRegistry = "https://registry.npmjs.org/";

function isRegistryOrOnDisk([nameAtResolution, registry]: Entry): boolean {
  if (registryVersion.test(nameAtResolution)) {
    return registry === "" || (typeof registry === "string" && registry.startsWith(defaultRegistry));
  }
  return onDisk.test(nameAtResolution);
}

function describeEntry([nameAtResolution, registry]: Entry): string {
  return typeof registry === "string" && registry !== "" ? `${nameAtResolution} from ${registry}` : nameAtResolution;
}

function offRegistryEntries(lockfile: string): string[] {
  const lock = Bun.JSONC.parse(readFileSync(path.join(repoRoot, lockfile), "utf8")) as {
    packages?: Record<string, Entry>;
  };
  return Object.entries(lock.packages ?? {})
    .filter(([, entry]) => !isRegistryOrOnDisk(entry))
    .map(([key, entry]) => `${key}: ${describeEntry(entry)}`);
}

test("isRegistryOrOnDisk accepts registry tarballs and on-disk resolutions only", () => {
  const entries: Entry[] = [
    ["esbuild@0.21.5", "", { bin: { esbuild: "bin/esbuild" } }, "sha512-mg3O"],
    ["@types/node@25.0.0", "", { dependencies: { "undici-types": "~7.16.0" } }, "sha512-rl78"],
    ["@wolfy1339/lru-cache@11.0.2-patch.1", "", {}, "sha512-BgYZ"],
    ["verdaccio@6.0.0-6-next.76", "", {}, "sha512-abcd"],
    ["wrap-ansi@9.0.2", "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-9.0.2.tgz", {}, "sha512-42At"],
    ["bun@root:", { bin: { bun: "bin/bun" } }],
    ["bun-types@workspace:packages/bun-types"],
    ["bun-plugin-svelte@file:../packages/bun-plugin-svelte", {}],
    ["react@link:../node_modules/react", {}],
    ["bun-tracestrings@github:oven-sh/bun.report#912ca63", {}, "oven-sh-bun.report-912ca63"],
    ["foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc", {}, "0123abc"],
    ["foo@git+https://github.com/oven-sh/foo.git#0123abc", {}, "0123abc"],
    ["foo@https://example.com/foo-1.0.0.tgz", {}],
    // Version in front, tarball somewhere else: what bun writes for a package
    // that came through a mirror, or for a github dependency migrated from
    // yarn.lock. Installs download from that URL.
    ["ansi-styles@6.2.3", "https://mirror.example.com/npm/ansi-styles/-/ansi-styles-6.2.3.tgz", {}, "sha512-4Dj6"],
    ["ghshort@3.0.1", "https://codeload.github.com/isaacs/abbrev-js/tar.gz/0123abc", {}, ""],
    ["foo@1.0.0", "https://registry.npmjs.org.example.com/foo/-/foo-1.0.0.tgz", {}, "sha512-0000"],
    ["foo@1.2.3.tgz", ""],
    ["foo@1.2.3@github:oven-sh/foo", ""],
    ["foo@", ""],
    ["no-resolution"],
  ];
  expect(Object.fromEntries(entries.map(entry => [describeEntry(entry), isRegistryOrOnDisk(entry)]))).toEqual({
    "esbuild@0.21.5": true,
    "@types/node@25.0.0": true,
    "@wolfy1339/lru-cache@11.0.2-patch.1": true,
    "verdaccio@6.0.0-6-next.76": true,
    "wrap-ansi@9.0.2 from https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-9.0.2.tgz": true,
    "bun@root:": true,
    "bun-types@workspace:packages/bun-types": true,
    "bun-plugin-svelte@file:../packages/bun-plugin-svelte": true,
    "react@link:../node_modules/react": true,
    "bun-tracestrings@github:oven-sh/bun.report#912ca63": false,
    "foo@git+ssh://git@github.com/oven-sh/foo.git#0123abc": false,
    "foo@git+https://github.com/oven-sh/foo.git#0123abc": false,
    "foo@https://example.com/foo-1.0.0.tgz": false,
    "ansi-styles@6.2.3 from https://mirror.example.com/npm/ansi-styles/-/ansi-styles-6.2.3.tgz": false,
    "ghshort@3.0.1 from https://codeload.github.com/isaacs/abbrev-js/tar.gz/0123abc": false,
    "foo@1.0.0 from https://registry.npmjs.org.example.com/foo/-/foo-1.0.0.tgz": false,
    "foo@1.2.3.tgz": false,
    "foo@1.2.3@github:oven-sh/foo": false,
    "foo@": false,
    "no-resolution": false,
  });
});

const lockfiles = committedLockfiles();

test("the lockfiles CI installs from are among the committed ones", () => {
  // Guards the lint below against `git ls-files` coming back empty or rooted
  // in the wrong directory, which would make it pass vacuously.
  expect(lockfiles).toEqual(
    expect.arrayContaining(["bun.lock", "test/bun.lock", "packages/bun-error/bun.lock", "src/node-fallbacks/bun.lock"]),
  );
});

test.each(lockfiles.filter(lockfile => !(lockfile in allowedOffRegistry)))(
  "%s downloads only from the npm registry",
  lockfile => {
    expect(offRegistryEntries(lockfile)).toEqual([]);
  },
);

test.each(Object.keys(allowedOffRegistry))("%s still needs its allowlist entry", lockfile => {
  expect(lockfiles).toContain(lockfile);
  // Once nothing in it comes from elsewhere any more, drop it from the list so
  // the lint covers it again.
  expect(offRegistryEntries(lockfile)).not.toEqual([]);
});
