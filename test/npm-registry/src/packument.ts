/**
 * Serializes a {@link PackageRecord} into the two documents a registry
 * serves from `GET /:name`, chosen by content negotiation:
 *
 *   - the full packument (`application/json`): every field the publisher
 *     sent, plus registry metadata (`time`, `_rev`, maintainers, …).
 *   - the abbreviated "corgi" packument
 *     (`application/vnd.npm.install-v1+json`): only the fields an
 *     installer needs. Notably `scripts` is replaced by the derived
 *     boolean `hasInstallScript`.
 *
 * Field lists follow
 * https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
 */

import {
  effectiveDistTags,
  effectiveTime,
  revString,
  sortedVersions,
  type Manifest,
  type PackageRecord,
  type ResolvedTarball,
} from "./package-store";
import type { AbbreviatedPackument, AbbreviatedVersionManifest, Dist, Packument, VersionManifest } from "./types";

export const ABBREVIATED_CONTENT_TYPE = "application/vnd.npm.install-v1+json";
export const FULL_CONTENT_TYPE = "application/json";

/**
 * `true` when the client's `Accept` header asks for the abbreviated
 * document. Real registries run full content negotiation; every npm
 * client that wants the corgi doc names the media type explicitly, so a
 * substring check is sufficient and keeps this independent of `q=`
 * weights (bun sends `install-v1+json; q=1.0, application/json; q=0.8`).
 */
export function wantsAbbreviated(accept: string | null): boolean {
  return accept !== null && accept.includes(ABBREVIATED_CONTENT_TYPE);
}

/**
 * The fields of a version manifest that appear in the abbreviated
 * document. Everything else the publisher sent (`description`, `author`,
 * `scripts`, `repository`, `main`, …) is stripped.
 */
const ABBREVIATED_FIELDS = [
  "name",
  "version",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "bundleDependencies",
  "bundledDependencies",
  "bin",
  "directories",
  "engines",
  "os",
  "cpu",
  "libc",
  "deprecated",
  "funding",
  "_hasShrinkwrap",
] as const;

const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"] as const;

/**
 * The registry-derived `hasInstallScript` flag: whether this version will
 * run a lifecycle script on install. npm computes this from `scripts`
 * only; a package relying on the implicit `node-gyp rebuild` for a
 * `binding.gyp` has `scripts.install` injected by the npm CLI at publish
 * time, so the registry never needs to look inside the tarball.
 */
export function hasInstallScript(manifest: Manifest): boolean {
  const scripts = manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) return false;
  // Truthiness, not presence: `"install": ""` runs nothing, and `normalize.ts`'s
  // gyp gate already reads these same fields that way.
  return INSTALL_SCRIPT_NAMES.some(name => Boolean((scripts as Record<string, unknown>)[name]));
}

/**
 * The `dist` object for a version, built from the resolved tarball and
 * the URL the registry serves it at. This never comes from a fixture or
 * a publish body: the registry owns `dist`, so it can never lie about
 * the bytes it will actually serve (unless a test asks it to via
 * `distOverride`).
 */
export function distFor(tarballUrl: string, resolved: ResolvedTarball): Dist {
  const dist: Dist = { integrity: resolved.integrity, shasum: resolved.shasum, tarball: tarballUrl };
  if (resolved.fileCount !== undefined) dist.fileCount = resolved.fileCount;
  if (resolved.unpackedSize !== undefined) dist.unpackedSize = resolved.unpackedSize;
  return dist;
}

/**
 * The spec path of a version's tarball, relative to the registry root:
 * `<name>/-/<basename>-<version>.tgz`. For scoped packages the basename
 * drops the scope (`@types/node@1.0.0` → `@types/node/-/node-1.0.0.tgz`),
 * which is what registry.npmjs.org serves and what `npm pack` names its
 * output.
 */
export function tarballPath(name: string, version: string): string {
  const basename = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${name}/-/${basename}-${version}.tgz`;
}

export interface SerializeContext {
  /** Registry origin with a trailing slash, e.g. `http://localhost:4873/`. */
  registryUrl: string;
}

interface LoadedVersion {
  version: string;
  manifest: Manifest;
  tarball: ResolvedTarball | undefined;
  distOverride: Partial<Dist> | undefined;
}

/** Resolves every version's manifest and tarball concurrently. */
async function loadAll(record: PackageRecord): Promise<LoadedVersion[]> {
  return Promise.all(
    sortedVersions(record).map(async version => {
      const stored = record.versions.get(version)!;
      const [manifest, tarball] = await Promise.all([stored.manifest(), stored.tarball?.()]);
      return { version, manifest, tarball, distOverride: stored.distOverride };
    }),
  );
}

function fullVersion(record: PackageRecord, loaded: LoadedVersion, dist: Dist): VersionManifest {
  return {
    ...loaded.manifest,
    name: record.name,
    version: loaded.version,
    _id: `${record.name}@${loaded.version}`,
    dist,
  } as VersionManifest;
}

function abbreviatedVersion(record: PackageRecord, loaded: LoadedVersion, dist: Dist): AbbreviatedVersionManifest {
  const out: Record<string, unknown> = {};
  for (const field of ABBREVIATED_FIELDS) {
    if (loaded.manifest[field] !== undefined) out[field] = loaded.manifest[field];
  }
  out.name = record.name;
  out.version = loaded.version;
  if (hasInstallScript(loaded.manifest)) out.hasInstallScript = true;
  out.dist = dist;
  return out as unknown as AbbreviatedVersionManifest;
}

/**
 * Serializes a record into a packument. A version declared `tarball: null`
 * is listed without integrity. An *error* resolving any version fails the
 * whole packument, and stays failed — the thunks memoize. Broken fixtures
 * should be loud.
 */
export async function toPackument(record: PackageRecord, ctx: SerializeContext): Promise<Packument>;
export async function toPackument(
  record: PackageRecord,
  ctx: SerializeContext,
  abbreviated: true,
): Promise<AbbreviatedPackument>;
export async function toPackument(
  record: PackageRecord,
  ctx: SerializeContext,
  abbreviated = false,
): Promise<Packument | AbbreviatedPackument> {
  const time = effectiveTime(record);

  const versions: Record<string, VersionManifest | AbbreviatedVersionManifest> = {};
  for (const loaded of await loadAll(record)) {
    const url = new URL(tarballPath(record.name, loaded.version), ctx.registryUrl).href;
    const dist = {
      ...(loaded.tarball ? distFor(url, loaded.tarball) : { tarball: url }),
      ...loaded.distOverride,
    } as Dist;
    versions[loaded.version] = abbreviated
      ? abbreviatedVersion(record, loaded, dist)
      : fullVersion(record, loaded, dist);
  }

  if (abbreviated) {
    return {
      name: record.name,
      modified: time.modified!,
      "dist-tags": effectiveDistTags(record),
      versions: versions as Record<string, AbbreviatedVersionManifest>,
    };
  }

  // `extra` holds publisher-supplied top-level fields (description,
  // readme, maintainers, …); the derived fields after it always win.
  return {
    ...record.extra,
    _id: record.name,
    _rev: revString(record),
    name: record.name,
    "dist-tags": effectiveDistTags(record),
    versions: versions as Record<string, VersionManifest>,
    time,
  };
}

/**
 * `GET /:name/:versionOrTag` — the registry's single-version document:
 * the full version manifest (identical to `versions[v]` in the full
 * packument), or 404 when neither a version nor a dist-tag matches.
 */
export async function toVersionManifest(
  record: PackageRecord,
  versionOrTag: string,
  ctx: SerializeContext,
): Promise<VersionManifest | undefined> {
  const version = record.versions.has(versionOrTag) ? versionOrTag : effectiveDistTags(record)[versionOrTag];
  if (version === undefined) return undefined;
  const stored = record.versions.get(version);
  if (stored === undefined) return undefined;
  const [manifest, tarball] = await Promise.all([stored.manifest(), stored.tarball?.()]);
  const url = new URL(tarballPath(record.name, version), ctx.registryUrl).href;
  const dist = { ...(tarball ? distFor(url, tarball) : { tarball: url }), ...stored.distOverride } as Dist;
  return fullVersion(record, { version, manifest, tarball, distOverride: stored.distOverride }, dist);
}
