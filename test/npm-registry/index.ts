/**
 * An in-process, spec-compliant npm registry for bun's test suite.
 *
 * ```ts
 * import { NpmRegistry } from "npm-registry";
 *
 * await using registry = await new NpmRegistry().start();
 * registry.define("left-pad", {
 *   "1.3.0": { tarball: { "index.js": "module.exports = s => s;\n" } },
 * });
 * // point `bunfig.toml` / `.npmrc` at registry.url and install.
 * ```
 *
 * See `README.md` for the fixture layout and the full API tour.
 */

export { NpmRegistry, type NpmRegistryOptions, type Uninstall } from "./src/registry";

export type { PackageOptions, VersionSpec } from "./src/define";
export type { Advisory } from "./src/audit";
export { OTP_REQUIRED_MESSAGE } from "./src/auth";
export type { AccessLevel, AccessRules, OtpChallengeOptions } from "./src/auth";
export type { Interceptor, ObservedRequest, SimulatedFailure } from "./src/observe";
export type {
  AbbreviatedPackument,
  AbbreviatedVersionManifest,
  Dist,
  FileTree,
  Packument,
  PublishBody,
  VersionManifest,
} from "./src/types";

// Lower-level pieces, exported for the registry's own tests and for
// tests that need a real npm tarball without a registry in front of it.
export { buildTarball, readTarball, readPackageJson } from "./src/tar";
export { computeIntegrity, shasum, sriSha512 } from "./src/integrity";
export { tarballPath, toPackument, hasInstallScript } from "./src/packument";
export { FixtureTree } from "./src/fixtures";
