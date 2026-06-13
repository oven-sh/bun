// Covers Package.parseWithJSON handling every Features flag combination in
// one install: workspaces / dependencies / devDependencies / optionalDependencies /
// peerDependencies / trustedDependencies / peerDependenciesMeta, across the root
// package and workspace packages. Guards the refactor that made `features: Features`
// a runtime parameter.
import { which } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// `Package.parseWithJSON` and `Package.parseDependency` used to take
// `comptime features: Features` / `comptime group: DependencyGroup`, which
// stamped out a separate copy of each function for every (ResolverContext,
// Features, group) combination — 9 and 17 respectively in a debug build.
// After making those parameters runtime, the instance counts collapse to the
// number of distinct ResolverContext types (parseWithJSON) and distinct
// comptime `tag` values (parseDependency).
//
// This test reads the symbol table of the binary under test and asserts the
// instance counts stay at the collapsed level. It's skipped when the binary
// is stripped (CI release builds) or `nm` is unavailable.
test.skipIf(isWindows || !which("nm"))(
  "Package.parseWithJSON/parseDependency are not over-monomorphised on Features",
  async () => {
    // `nm` on a debug+ASAN binary emits hundreds of MB; pipe through grep so
    // only the handful of matching lines reach this process.
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `nm '${bunExe()}' 2>/dev/null | grep -E '\\.parseWithJSON|\\.parseDependency'`],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.split("\n").filter(Boolean);
    const parseWithJSON = lines.filter(l => l.includes(".parseWithJSON"));
    const parseDependency = lines.filter(l => l.includes(".parseDependency"));

    // Binary is stripped (CI release) or nm failed — nothing to assert.
    if (parseWithJSON.length === 0 && parseDependency.length === 0) return;

    // Before: 9 parseWithJSON instances (one per (ResolverContext, Features) pair).
    // After:  one per ResolverContext type (7 today).
    expect(parseWithJSON.length).toBeLessThanOrEqual(7);

    // Before: 17 parseDependency instances in debug (comptime group × features × tag).
    // After:  one per comptime `tag` value (2: .workspace and null).
    expect(parseDependency.length).toBeLessThanOrEqual(2);
  },
);

describe.concurrent("parseWithJSON", () => {
  test("handles all dependency groups across root and workspace packages", async () => {
    using dir = tempDir("parse-features", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: {
          "pkg-a": "workspace:*",
        },
        devDependencies: {
          "pkg-b": "workspace:*",
        },
        optionalDependencies: {
          "pkg-c": "workspace:*",
        },
        peerDependencies: {
          "pkg-a": "workspace:*",
        },
        trustedDependencies: ["pkg-a", "pkg-b"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          "pkg-b": "workspace:*",
        },
        peerDependencies: {
          "pkg-c": "*",
        },
        peerDependenciesMeta: {
          "pkg-c": { optional: true },
          // meta-only entry (no matching peerDependencies key) → synthesised
          // optional peer on "*"
          "pkg-b": { optional: true },
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "2.0.0",
        devDependencies: {
          "pkg-a": "workspace:^",
        },
        optionalDependencies: {
          "pkg-c": "workspace:~",
        },
      }),
      "packages/pkg-c/package.json": JSON.stringify({
        name: "pkg-c",
        version: "3.0.0",
        dependencies: {
          // folder dep — exercises the Features.folder path
          "local-dep": "file:../../local-dep",
        },
      }),
      "local-dep/package.json": JSON.stringify({
        name: "local-dep",
        version: "0.0.1",
        peerDependencies: { "pkg-a": "*" },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();

    // Root package: all five dependency groups present, in a stable order,
    // plus trustedDependencies surviving the Features.is_main path.
    expect(lockfile).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 1,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "root",
          "dependencies": {
            "pkg-a": "workspace:*",
          },
          "devDependencies": {
            "pkg-b": "workspace:*",
          },
          "optionalDependencies": {
            "pkg-c": "workspace:*",
          },
          "peerDependencies": {
            "pkg-a": "workspace:*",
          },
        },
        "packages/pkg-a": {
          "name": "pkg-a",
          "version": "1.0.0",
          "dependencies": {
            "pkg-b": "workspace:*",
          },
          "peerDependencies": {
            "pkg-b": "*",
            "pkg-c": "*",
          },
          "optionalPeers": [
            "pkg-b",
            "pkg-c",
          ],
        },
        "packages/pkg-b": {
          "name": "pkg-b",
          "version": "2.0.0",
          "devDependencies": {
            "pkg-a": "workspace:^",
          },
          "optionalDependencies": {
            "pkg-c": "workspace:~",
          },
        },
        "packages/pkg-c": {
          "name": "pkg-c",
          "version": "3.0.0",
          "dependencies": {
            "local-dep": "file:../../local-dep",
          },
        },
      },
      "trustedDependencies": [
        "pkg-b",
        "pkg-a",
      ],
      "packages": {
        "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

        "pkg-b": ["pkg-b@workspace:packages/pkg-b"],

        "pkg-c": ["pkg-c@workspace:packages/pkg-c"],

        "pkg-c/local-dep": ["local-dep@file:local-dep", { "peerDependencies": { "pkg-a": "*" } }],
      }
    }
    "
  `);
  });

  test("warns on duplicate dependencies in root package.json", async () => {
    // Features.main sets check_for_duplicate_dependencies=true; a key listed in both
    // dependencies and devDependencies should warn (not in optionalDependencies though,
    // where duplication is allowed and the optional entry wins).
    using dir = tempDir("parse-features-dup", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: {
          "pkg-a": "workspace:*",
        },
        devDependencies: {
          "pkg-a": "workspace:*",
        },
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Duplicate dependency");
    expect(stderr).toContain('"pkg-a"');
    expect(exitCode).toBe(0);
  });
});
