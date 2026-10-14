import type {
  BunLockFile,
  BunLockFileGitPackage,
  BunLockFileNpmPackage,
  BunLockFilePackageArray,
  BunLockFilePackageInfo,
  BunLockFilePathPackage,
  BunLockFileRootPackage,
  BunLockFileTarballPackage,
  BunLockFileWorkspacePackageArray,
} from "bun";

const info: BunLockFilePackageInfo = {
  dependencies: { foo: "^1.0.0" },
  os: ["darwin", "linux"],
  cpu: "x64",
  bundled: true,
};

// Every documented `packages` tuple shape is assignable to the union.
const npm: BunLockFilePackageArray = ["lodash@4.17.21", "", info, "sha512-abc"];
const npmScopedRegistry: BunLockFilePackageArray = ["pkg@1.0.0", "https://npm.example.com/", info, "sha512-abc"];
const workspace: BunLockFilePackageArray = ["@app/ui@workspace:packages/ui"];
const folder: BunLockFilePackageArray = ["dep@file:./dep", info];
const symlink: BunLockFilePackageArray = ["dep@link:./dep", info];
const tarball: BunLockFilePackageArray = ["dep@./dep-1.0.0.tgz", info];
// Tarball with a trailing integrity — the 3-element form the schema previously omitted.
const tarballWithIntegrity: BunLockFilePackageArray = ["dep@./dep-1.0.0.tgz", info, "sha512-abc"];
const git: BunLockFilePackageArray = ["dep@git+https://github.com/u/r.git", info, "abcdef1"];
// git/github with a trailing integrity — the 4-element form the old union rejected outright.
const gitWithIntegrity: BunLockFilePackageArray = ["dep@github:u/r", info, "abcdef1", "sha512-abc"];
const root: BunLockFilePackageArray = ["app@root:", { bin: "./cli.js" }];
const rootEmpty: BunLockFilePackageArray = ["app@root:", {}];

// Each resolution-specific type accepts its own shape (the specifier prefix and
// the integrity format act as the discriminant).
const npmT: BunLockFileNpmPackage = ["lodash@4.17.21", "", info, "sha512-abc"];
const workspaceT: BunLockFileWorkspacePackageArray = ["@app/ui@workspace:packages/ui"];
const folderT: BunLockFilePathPackage = ["dep@file:./dep", info];
const symlinkT: BunLockFilePathPackage = ["dep@link:./dep", info];
const tarballT: BunLockFileTarballPackage = ["dep@./dep-1.0.0.tgz", info, "sha512-abc"];
const gitT: BunLockFileGitPackage = ["dep@github:u/r", info, "abcdef1", "sha512-abc"];
const rootT: BunLockFileRootPackage = ["app@root:", { bin: "./cli.js" }];

// A complete lockfile object typechecks.
const lockfile: BunLockFile = {
  lockfileVersion: 2,
  configVersion: 1,
  workspaces: {
    "": { name: "app", dependencies: { lodash: "^4.17.21" } },
    "packages/ui": { name: "@app/ui", version: "1.0.0" },
  },
  overrides: { lodash: "4.17.21" },
  trustedDependencies: ["esbuild"],
  patchedDependencies: { "lodash@4.17.21": "patches/lodash.patch" },
  catalog: { react: "^18.0.0" },
  catalogs: { legacy: { react: "^17.0.0" } },
  packages: {
    lodash: npm,
    "@app/ui": workspace,
  },
};

// Invalid shapes are rejected by the types.

// @ts-expect-error an empty tuple is never a valid package entry
const badEmpty: BunLockFilePackageArray = [];
// @ts-expect-error lockfileVersion must be 0 | 1 | 2
const badVersion: BunLockFile = { lockfileVersion: 3, workspaces: {}, packages: {} };
// @ts-expect-error `packages` is required
const badMissingPackages: BunLockFile = { lockfileVersion: 2, workspaces: {} };

// Cross-resolution entries are rejected: each mismatch below differs from the
// target only in its resolution discriminant.

// @ts-expect-error a root package (`@root:`) is not a path package (`@link:`/`@file:`)
const rootAsPath: BunLockFilePathPackage = ["app@root:", {}];
// @ts-expect-error a path package (`@link:`) is not a root package (`@root:`)
const pathAsRoot: BunLockFileRootPackage = ["dep@link:./dep", {}];
// @ts-expect-error a git package's `resolved` is not a tarball's integrity hash
const gitAsTarball: BunLockFileTarballPackage = ["dep@git+https://github.com/u/r.git", {}, "abcdef1"];
// @ts-expect-error a tarball specifier is not a git specifier (`@git+`/`@github:`)
const tarballAsGit: BunLockFileGitPackage = ["dep@./dep-1.0.0.tgz", {}, "sha512-abc"];

// Known overlap: `BunLockFileTarballPackage` uses a plain `string` pkg, so a
// two-element path (`@file:`/`@link:`) tuple is also structurally a tarball.
// Tarball is the fallback shape, discriminated by exclusion, not by a prefix.
const pathIsAlsoTarball: BunLockFileTarballPackage = ["dep@file:./dep", info];
