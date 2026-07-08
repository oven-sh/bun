/**
 * The in-code package definition API.
 *
 * This is how a test puts a package on the registry without a `.tgz`
 * anywhere: describe the package.json and (optionally) the files, and
 * the registry builds the tarball, computes its integrity, and derives
 * the packument. Because the tarball writer is deterministic, the
 * resulting `dist.integrity` is stable across runs and safe to snapshot.
 *
 * ```ts
 * registry.define("say-hi", {
 *   "1.0.0": {},
 *   "2.0.0": {
 *     bin: { "say-hi": "cli.js" },
 *     dependencies: { chalk: "^5" },
 *     tarball: { "cli.js": "#!/usr/bin/env node\nconsole.log('hi')\n" },
 *   },
 * });
 * ```
 */

import { normalizeManifest } from "./normalize";
import {
  createRecord,
  manifestFromValue,
  tarballFromBytes,
  tarballFromFiles,
  type Manifest,
  type PackageRecord,
  type StoredVersion,
} from "./package-store";
import type { Dist, FileTree, Version } from "./types";

/**
 * One version, as a test author writes it. Two keys are interpreted by
 * the registry; everything else becomes the version's package.json
 * verbatim (`name` and `version` are filled in).
 */
export interface VersionSpec {
  /**
   * What to serve as the tarball.
   *
   * - omitted: a tarball containing only the generated `package.json`.
   * - a file tree: those files plus the generated `package.json`,
   *   packed deterministically. Don't include a `package.json` here;
   *   the other fields of this spec *are* the package.json.
   * - raw bytes: served verbatim. For malformed-archive tests.
   * - `null`: the version is listed in the packument but its tarball
   *   404s, like a registry whose storage lost the object.
   */
  tarball?: FileTree | Uint8Array | null;
  /**
   * Overrides for the registry-computed `dist` object. The registry
   * normally derives `integrity`/`shasum` from the bytes it serves;
   * setting them here makes it advertise something else, which is how
   * integrity-verification failures are simulated.
   */
  dist?: Partial<Dist>;

  // Common package.json fields, typed for editor support. The index
  // signature below admits the rest (`main`, `exports`, `scripts`, …).
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  bundleDependencies?: string[] | boolean;
  bin?: string | Record<string, string>;
  directories?: { bin?: string };
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  deprecated?: string;
  [field: string]: unknown;
}

/** Package-level (not per-version) registry metadata. */
export interface PackageOptions {
  /**
   * Explicit dist-tags. When omitted, `latest` is the highest
   * non-prerelease version.
   */
  distTags?: Record<string, Version>;
  /** Explicit publish timestamps, keyed by version. */
  time?: Record<string, string>;
  /**
   * Extra top-level packument fields (`description`, `readme`,
   * `maintainers`, …). Purely cosmetic for installs; some `bun pm view`
   * output depends on them.
   */
  packument?: Record<string, unknown>;
}

/** The keys of a {@link VersionSpec} that are not package.json fields. */
const REGISTRY_ONLY_KEYS: readonly string[] = ["tarball", "dist"] satisfies readonly (keyof VersionSpec)[];

/**
 * The set of paths within a package that should be executable: every
 * `bin` target, and everything under `directories.bin`. npm's `.bin/`
 * links only work when the target has the execute bit, and `npm pack`
 * preserves it from disk; an in-memory definition has no mode, so
 * derive it from intent.
 */
export function executablePaths(manifest: Manifest, filePaths: Iterable<string>): string[] {
  const paths = new Set<string>();
  const bin = manifest.bin;
  if (typeof bin === "string") paths.add(bin);
  else if (typeof bin === "object" && bin !== null) {
    for (const target of Object.values(bin as Record<string, string>)) paths.add(target);
  }
  const binDir = (manifest.directories as { bin?: string } | undefined)?.bin;
  if (typeof binDir === "string") {
    const prefix = `${binDir.replace(/^\.\//, "").replace(/\/+$/, "")}/`;
    for (const path of filePaths) if (path.startsWith(prefix)) paths.add(path);
  }
  return [...paths].map(p => p.replace(/^\.\//, ""));
}

function storedVersion(name: string, version: Version, spec: VersionSpec): StoredVersion {
  // Everything that isn't a registry directive is the package.json,
  // exactly as an author would have written it.
  const raw: Manifest = {};
  for (const key of Object.keys(spec)) {
    if (!REGISTRY_ONLY_KEYS.includes(key)) raw[key] = spec[key];
  }
  raw.name = name;
  raw.version = version;

  const extra = spec.tarball !== null && !(spec.tarball instanceof Uint8Array) ? (spec.tarball ?? {}) : undefined;
  if (extra !== undefined && "package.json" in extra) {
    throw new Error(
      `${name}@${version}: don't put a package.json in \`tarball\`; ` +
        "the other fields of the version spec are the package.json",
    );
  }

  // The tarball carries the author's package.json verbatim; the
  // registry stores and serves the normalized manifest, exactly the
  // document `npm publish` would have sent it.
  const manifest = normalizeManifest(name, raw, Object.keys(extra ?? {}));

  let tarball: StoredVersion["tarball"];
  if (spec.tarball === null) {
    tarball = undefined;
  } else if (spec.tarball instanceof Uint8Array) {
    const bytes = spec.tarball;
    tarball = tarballFromBytes(async () => bytes);
  } else {
    const files = { "package.json": `${JSON.stringify(raw, null, 2)}\n`, ...extra };
    tarball = tarballFromFiles(async () => ({ files, executable: executablePaths(manifest, Object.keys(files)) }));
  }

  return { manifest: manifestFromValue(manifest), tarball, distOverride: spec.dist };
}

/** Builds a {@link PackageRecord} from in-code version specs. */
export function recordFromSpecs(
  name: string,
  versions: Record<Version, VersionSpec>,
  options: PackageOptions = {},
): PackageRecord {
  const record = createRecord(name);
  for (const [version, spec] of Object.entries(versions)) {
    record.versions.set(version, storedVersion(name, version, spec));
  }
  if (options.distTags) record.distTags = { ...options.distTags };
  if (options.time) record.time = { ...options.time };
  if (options.packument) record.extra = { ...options.packument };
  return record;
}
