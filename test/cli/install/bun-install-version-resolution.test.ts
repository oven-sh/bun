import { file } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `bun install` spawns are slow under the debug/ASAN build; use the same
// timeout the other install test files use.
setDefaultTimeout(1000 * 60 * 5);

// Checks that `bun install` picks the same version npm does for npm ranges.
// Every expectation was verified against npm 11 / npm-pick-manifest with the
// same packuments; `--lockfile-only` means tarballs are never requested.

type Packages = Record<string, { versions: string[]; latest?: string; time?: Record<string, string> }>;

async function resolve(packages: Packages, dependencies: Record<string, string>, minimumReleaseAgeSeconds?: number) {
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
        ...(pkg.time ? { time: pkg.time } : {}),
      });
    },
  });

  using dir = tempDir("version-resolution", {
    "package.json": JSON.stringify({ name: "test-pkg", version: "1.0.0", dependencies }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "${server.url.origin}/"\nsaveTextLockfile = true\n${
      minimumReleaseAgeSeconds !== undefined ? `minimumReleaseAge = ${minimumReleaseAgeSeconds}\n` : ""
    }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

  const lockfile = await file(join(String(dir), "bun.lock")).text();
  const lock = JSON.parse(lockfile.replace(/,(\s*[\]}])/g, "$1"));
  const resolved: Record<string, string> = Object.fromEntries(
    Object.entries(lock.packages as Record<string, string[]>).map(([name, entry]) => [
      name,
      entry[0].slice(name.length + 1),
    ]),
  );
  return { resolved, stdout, stderr };
}

describe.concurrent("bun install version resolution", () => {
  // A satisfying prerelease that is higher than the best satisfying stable
  // release must win. npm: 1.2.0-alpha.1
  test("prerelease above the best matching stable is chosen", async () => {
    const { resolved, stderr } = await resolve(
      { "pre-above-stable": { versions: ["1.1.1", "1.2.0-alpha.1", "2.0.0"], latest: "2.0.0" } },
      { "pre-above-stable": "<1.2.0-alpha.2" },
    );
    expect(stderr).not.toContain("error:");
    expect(resolved["pre-above-stable"]).toBe("1.2.0-alpha.1");
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
    const { resolved, stderr } = await resolve(
      { "only-pre": { versions: ["1.0.0-beta.1", "1.0.0-beta.2"], latest: "1.0.0-beta.2" } },
      { "only-pre": "*" },
    );
    expect(stderr).not.toContain("No version matching");
    expect(resolved["only-pre"]).toBe("1.0.0-beta.2");
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

  // Only the literal `*` follows a prerelease latest dist-tag. npm resolves
  // `>=0.0.0` and `x` with a plain satisfies check, which excludes
  // prereleases, so both pick 1.0.0 here.
  test("ranges equivalent to star do not follow a prerelease latest dist-tag", async () => {
    const packages: Packages = {
      "star-like": { versions: ["1.0.0", "2.0.0-beta.1"], latest: "2.0.0-beta.1" },
    };
    const gte_zero = await resolve(packages, { "star-like": ">=0.0.0" });
    const x_range = await resolve(packages, { "star-like": "x" });
    expect(gte_zero.resolved["star-like"]).toBe("1.0.0");
    expect(x_range.resolved["star-like"]).toBe("1.0.0");
  });

  // With minimumReleaseAge, `*` keeps the dist-tag fallback: a too recent
  // latest falls back to an older version from the same list, including
  // prereleases on a prerelease-only package.
  test("star range with minimumReleaseAge falls back to an older prerelease", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const { resolved, stderr } = await resolve(
      {
        "aged-pre": {
          versions: ["1.0.0-beta.1", "1.0.0-beta.2"],
          latest: "1.0.0-beta.2",
          time: {
            "1.0.0-beta.1": new Date(Date.now() - 10 * DAY_MS).toISOString(),
            "1.0.0-beta.2": new Date(Date.now() - 60 * 1000).toISOString(),
          },
        },
      },
      { "aged-pre": "*" },
      2 * 24 * 60 * 60,
    );
    expect(stderr).not.toContain("No version matching");
    expect(resolved["aged-pre"]).toBe("1.0.0-beta.1");
  });

  // When every version in the latest dist-tag's prerelease channel is too
  // recent, `*` still falls back to an old enough stable release.
  test("star range with minimumReleaseAge falls back to a stable when the latest channel is too recent", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const { resolved, stderr } = await resolve(
      {
        "aged-mixed": {
          versions: ["1.0.0", "2.0.0-beta.1"],
          latest: "2.0.0-beta.1",
          time: {
            "1.0.0": new Date(Date.now() - 365 * DAY_MS).toISOString(),
            "2.0.0-beta.1": new Date(Date.now() - 60 * 1000).toISOString(),
          },
        },
      },
      { "aged-mixed": "*" },
      2 * 24 * 60 * 60,
    );
    expect(stderr).not.toContain("minimum-release-age");
    expect(resolved["aged-mixed"]).toBe("1.0.0");
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

  // `*` and `>=0.0.0` parse to the same comparators but resolve differently
  // when latest is a prerelease, so changing one to the other in package.json
  // has to re-resolve instead of keeping the locked version.
  test("changing between star and an equivalent range re-resolves", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
        if (name !== "star-relock") return new Response("not found", { status: 404 });
        return Response.json({
          name,
          "dist-tags": { latest: "2.0.0-beta.1" },
          versions: Object.fromEntries(
            ["1.0.0", "2.0.0-beta.1"].map(version => [
              version,
              { name, version, dist: { tarball: `${server.url.origin}/star-relock-${version}.tgz` } },
            ]),
          ),
        });
      },
    });

    const packageJson = (range: string) =>
      JSON.stringify({ name: "test-pkg", version: "1.0.0", dependencies: { "star-relock": range } });

    using dir = tempDir("version-resolution-star-relock", {
      "package.json": packageJson("*"),
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
      expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
      return await file(join(String(dir), "bun.lock")).text();
    }

    expect(await install()).toContain("star-relock@2.0.0-beta.1");

    await Bun.write(join(String(dir), "package.json"), packageJson(">=0.0.0"));
    expect(await install()).toContain("star-relock@1.0.0");
  });
});
