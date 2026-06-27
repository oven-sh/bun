import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Checks that `bun install` picks the same version npm does for npm ranges.
// Every expectation in this file was verified against npm 11 (and
// npm-pick-manifest directly) using the same packuments served from a local
// registry. The registry only has to serve packuments because resolution runs
// with `--lockfile-only`, so tarballs are never requested.

type Packages = Record<string, { versions: string[]; latest?: string }>;

async function resolve(packages: Packages, dependencies: Record<string, string>) {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const pkg = packages[name];
      if (!pkg) return new Response("not found", { status: 404 });
      return Response.json({
        name,
        "dist-tags": pkg.latest ? { latest: pkg.latest } : {},
        versions: Object.fromEntries(
          pkg.versions.map(version => [
            version,
            { name, version, dist: { tarball: `${server.url.origin}/${name}-${version}.tgz` } },
          ]),
        ),
      });
    },
  });

  using dir = tempDir("version-resolution", {
    "package.json": JSON.stringify({ name: "test-pkg", version: "1.0.0", dependencies }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url.origin}/"\nsaveTextLockfile = true\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  let resolved: Record<string, string> = {};
  if (exitCode === 0) {
    const lockfile = await file(join(String(dir), "bun.lock")).text();
    const lock = JSON.parse(lockfile.replace(/,(\s*[\]}])/g, "$1"));
    resolved = Object.fromEntries(
      Object.entries(lock.packages as Record<string, string[]>).map(([name, entry]) => [
        name,
        entry[0].slice(name.length + 1),
      ]),
    );
  }
  return { resolved, stdout, stderr, exitCode };
}

describe.concurrent("bun install version resolution", () => {
  // A satisfying prerelease that is higher than the best satisfying stable
  // release must win. npm: 1.2.0-alpha.1
  test("prerelease above the best matching stable is chosen", async () => {
    const { resolved, stderr, exitCode } = await resolve(
      { "pre-above-stable": { versions: ["1.1.1", "1.2.0-alpha.1", "2.0.0"], latest: "2.0.0" } },
      { "pre-above-stable": "<1.2.0-alpha.2" },
    );
    expect(resolved["pre-above-stable"]).toBe("1.2.0-alpha.1");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  // npm: 2.0.0-rc.1 (1.2.0 and 2.0.0-rc.1 both satisfy, the prerelease is higher)
  test("prerelease upper bound is reachable when a lower stable also satisfies", async () => {
    const { resolved } = await resolve(
      { "rc-upper-bound": { versions: ["1.2.0", "2.0.0-rc.1", "3.0.0"], latest: "3.0.0" } },
      { "rc-upper-bound": "<=2.0.0-rc.1" },
    );
    expect(resolved["rc-upper-bound"]).toBe("2.0.0-rc.1");
  });

  // npm: 2.1.0 for both spellings. The first `||` alternative being an exact
  // version must not short-circuit the rest of the group.
  test("exact version first in an || group still considers the other alternatives", async () => {
    const { resolved } = await resolve(
      { "or-exact": { versions: ["1.0.0", "2.0.0", "2.1.0"], latest: "2.1.0" } },
      { "or-exact": "1.0.0 || ^2.0.0" },
    );
    expect(resolved["or-exact"]).toBe("2.1.0");
  });

  test("|| resolution does not depend on the order of alternatives", async () => {
    const packages: Packages = { "or-reversed": { versions: ["1.0.0", "2.0.0", "2.1.0"], latest: "2.1.0" } };
    const first = await resolve(packages, { "or-reversed": "1.0.0 || ^2.0.0" });
    const second = await resolve(packages, { "or-reversed": "^2.0.0 || 1.0.0" });
    expect(first.resolved["or-reversed"]).toBe("2.1.0");
    expect(second.resolved["or-reversed"]).toBe("2.1.0");
  });

  // Same as above, but `latest` does not satisfy the range so the version
  // lists have to be scanned. npm: 2.1.0
  test("exact version first in an || group, latest dist-tag outside the range", async () => {
    const { resolved } = await resolve(
      { "or-scan": { versions: ["1.0.0", "2.0.0", "2.1.0", "3.0.0"], latest: "3.0.0" } },
      { "or-scan": "1.0.0 || ^2.0.0" },
    );
    expect(resolved["or-scan"]).toBe("2.1.0");
  });

  // npm: 1.0.0. The exact alternative is the only one with a matching version.
  test("exact version in an || group is used when it is the only match", async () => {
    const { resolved } = await resolve(
      { "or-only-exact": { versions: ["1.0.0", "2.0.0"], latest: "2.0.0" } },
      { "or-only-exact": "1.0.0 || ^3.0.0" },
    );
    expect(resolved["or-only-exact"]).toBe("1.0.0");
  });

  // npm resolves `*` to the `latest` dist-tag. A package with only
  // prereleases must install instead of failing with "No version matching".
  test("star range on a package with only prereleases resolves to the latest dist-tag", async () => {
    const { resolved, stderr, exitCode } = await resolve(
      { "only-pre": { versions: ["1.0.0-beta.1", "1.0.0-beta.2"], latest: "1.0.0-beta.2" } },
      { "only-pre": "*" },
    );
    expect(stderr).not.toContain("No version matching");
    expect(resolved["only-pre"]).toBe("1.0.0-beta.2");
    expect(exitCode).toBe(0);
  });

  // npm: 2.0.0-beta.1. For `*` the latest dist-tag wins even when it is a
  // prerelease and stable versions exist.
  test("star range follows a prerelease latest dist-tag", async () => {
    const { resolved } = await resolve(
      { "star-pre-latest": { versions: ["1.0.0", "2.0.0-beta.1"], latest: "2.0.0-beta.1" } },
      { "star-pre-latest": "*" },
    );
    expect(resolved["star-pre-latest"]).toBe("2.0.0-beta.1");
  });

  test("star range on a package with stable versions resolves to latest", async () => {
    const { resolved } = await resolve(
      { "star-stable": { versions: ["1.0.0", "2.0.0"], latest: "2.0.0" } },
      { "star-stable": "*" },
    );
    expect(resolved["star-stable"]).toBe("2.0.0");
  });

  // npm prefers a satisfying `latest` dist-tag over higher satisfying
  // versions, for stable ranges and prerelease ranges alike.
  test("a satisfying latest dist-tag is preferred over higher versions", async () => {
    const held_back = await resolve(
      { "held-back": { versions: ["1.0.0", "1.1.0", "1.2.0"], latest: "1.1.0" } },
      { "held-back": "^1.0.0" },
    );
    expect(held_back.resolved["held-back"]).toBe("1.1.0");

    const prerelease_latest = await resolve(
      { "pre-latest": { versions: ["1.0.0-0", "1.0.0-8"], latest: "1.0.0-0" } },
      { "pre-latest": "^1.0.0-0" },
    );
    expect(prerelease_latest.resolved["pre-latest"]).toBe("1.0.0-0");

    // npm: 1.2.0. latest satisfies `<=2.0.0-rc.1`, so it wins over the higher
    // satisfying prerelease.
    const stable_latest_in_pre_range = await resolve(
      { "rc-with-latest": { versions: ["1.2.0", "2.0.0-rc.1"], latest: "1.2.0" } },
      { "rc-with-latest": "<=2.0.0-rc.1" },
    );
    expect(stable_latest_in_pre_range.resolved["rc-with-latest"]).toBe("1.2.0");

    // npm: 1.2.4 (latest satisfies), not 1.3.0.
    const pre_range_latest_stable = await resolve(
      { "pre-range-latest": { versions: ["1.2.3-alpha.1", "1.2.4", "1.3.0"], latest: "1.2.4" } },
      { "pre-range-latest": "^1.2.3-alpha.1" },
    );
    expect(pre_range_latest_stable.resolved["pre-range-latest"]).toBe("1.2.4");
  });

  test("star resolution to a prerelease survives a reinstall", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
        if (name !== "only-pre-lock") return new Response("not found", { status: 404 });
        return Response.json({
          name,
          "dist-tags": { latest: "2.0.0-canary.7" },
          versions: {
            "2.0.0-canary.7": {
              name,
              version: "2.0.0-canary.7",
              dist: { tarball: `${server.url.origin}/only-pre-lock-2.0.0-canary.7.tgz` },
            },
          },
        });
      },
    });

    using dir = tempDir("version-resolution-relock", {
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        dependencies: { "only-pre-lock": "*" },
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url.origin}/"\nsaveTextLockfile = true\n`,
    });

    async function install() {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const first = await install();
    expect(first.stderr).not.toContain("No version matching");
    expect(first.exitCode).toBe(0);
    const lockfile = await file(join(String(dir), "bun.lock")).text();
    expect(lockfile).toContain("only-pre-lock@2.0.0-canary.7");

    const second = await install();
    expect(second.stderr).not.toContain("No version matching");
    expect(second.exitCode).toBe(0);
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockfile);
  });
});
