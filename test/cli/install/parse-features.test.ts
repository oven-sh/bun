// Covers Package.parseWithJSON handling every Features flag combination in
// one install: workspaces / dependencies / devDependencies / optionalDependencies /
// peerDependencies / trustedDependencies / peerDependenciesMeta, across the root
// package and workspace packages. Guards the refactor that made `features: Features`
// a runtime parameter.
import { write } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("parseWithJSON handles all dependency groups across root and workspace packages", async () => {
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
    }),
  });

  // folder dep below points at a relative dir with its own package.json
  await write(
    join(String(dir), "local-dep", "package.json"),
    JSON.stringify({
      name: "local-dep",
      version: "0.0.1",
      peerDependencies: { "pkg-a": "*" },
    }),
  );
  await write(
    join(String(dir), "packages", "pkg-c", "package.json"),
    JSON.stringify({
      name: "pkg-c",
      version: "3.0.0",
      dependencies: {
        "local-dep": "file:../../local-dep",
      },
    }),
  );

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

test("parseWithJSON warns on duplicate dependencies in root package.json", async () => {
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
