/**
 * In-memory storage for packages and their versions.
 *
 * A {@link PackageRecord} is the registry's state for one package name:
 * versions, dist-tags, deprecations, publish times. It is the single
 * source of truth from which both packument shapes are serialized
 * (`packument.ts`) — nothing about HTTP or JSON lives here.
 *
 * Both the manifest and the tarball of a {@link StoredVersion} are memoized
 * async thunks, so a registry over hundreds of fixtures is O(1) to start.
 * Serving one packument resolves *every* version of that package, tarball
 * included (`dist.integrity` hashes the gzipped bytes), then memoizes.
 */

import { computeIntegrity, type Integrity } from "./integrity";
import { buildTarball, type TarballStats } from "./tar";
import type { Dist, FileTree, Version } from "./types";

/**
 * The publish timestamp assigned to the first version of every package.
 * Matches the fixed mtime `tar.ts` writes so the whole registry is a pure
 * function of its inputs. Subsequent versions get one minute each.
 */
export const EPOCH = Date.UTC(1985, 9, 26, 8, 15, 0);
const VERSION_TIME_STEP_MS = 60_000;

/**
 * A version's package.json as published. `name` and `version` are
 * authoritative from the record, not from here; they are normalized at
 * serialization time.
 */
export type Manifest = Record<string, unknown>;

export interface ResolvedTarball extends Integrity, Partial<TarballStats> {
  bytes: Uint8Array;
}

/** Everything the registry stores about one published version. */
export interface StoredVersion {
  /**
   * Resolves the version's package.json. The registry-owned fields
   * (`dist`, `_id`) are never taken from here; they are derived at
   * serialization time so they can never disagree with the tarball.
   */
  readonly manifest: () => Promise<Manifest>;
  /**
   * Resolves the tarball and its hashes. `undefined` models a version
   * that exists in the packument but whose tarball the registry cannot
   * serve (a real registry failure mode several tests rely on).
   */
  readonly tarball: (() => Promise<ResolvedTarball>) | undefined;
  /**
   * Fields that override the registry-computed `dist` object. Used by
   * tests that need the registry to advertise metadata that does not
   * match the bytes it serves (integrity-mismatch tests).
   */
  readonly distOverride?: Partial<Dist>;
}

/** All registry state for one package name. Mutated only by `publish.ts`. */
export interface PackageRecord {
  name: string;
  versions: Map<Version, StoredVersion>;
  /**
   * Explicit dist-tags. `latest` is filled in at serialization time when
   * absent (highest non-prerelease version, then highest overall), so
   * most packages never need to set this.
   */
  distTags: Record<string, Version>;
  /**
   * Explicit `time` entries. Missing versions are assigned deterministic
   * timestamps at serialization time.
   */
  time: Record<string, string>;
  /** CouchDB-style revision, bumped on every write. */
  rev: number;
  /** Top-level packument fields that are not derived (description, readme, …). */
  extra: Record<string, unknown>;
}

export function createRecord(name: string): PackageRecord {
  return { name, versions: new Map(), distTags: {}, time: {}, rev: 1, extra: {} };
}

/**
 * A shallow, independent copy: mutating the clone's maps and objects
 * never touches the original. `StoredVersion`s are immutable so they
 * are shared. This is how a registry publishes on top of a fixture
 * without corrupting the process-wide fixture cache.
 */
export function cloneRecord(record: PackageRecord): PackageRecord {
  return {
    name: record.name,
    versions: new Map(record.versions),
    distTags: { ...record.distTags },
    time: { ...record.time },
    rev: record.rev,
    extra: { ...record.extra },
  };
}

/** Wraps an async producer so it runs at most once. */
export function memo<T>(produce: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return () => (result ??= produce());
}

/** A manifest that already exists in memory (defined in code, or published). */
export function manifestFromValue(manifest: Manifest): () => Promise<Manifest> {
  const resolved = Promise.resolve(manifest);
  return () => resolved;
}

/**
 * A tarball backed by bytes that already exist (a prebuilt `.tgz` fixture, or
 * a `tarball: Uint8Array` spec). The bytes are never parsed: several specs
 * hand over a deliberately malformed archive, and `dist` must still serialize.
 * That is why such a version has no `fileCount`/`unpackedSize`.
 */
export function tarballFromBytes(read: () => Promise<Uint8Array>): () => Promise<ResolvedTarball> {
  return memo(async () => {
    const bytes = await read();
    return { bytes, ...computeIntegrity(bytes) };
  });
}

/**
 * A tarball built on demand from an in-memory file tree. This is how
 * in-code and directory fixtures avoid ever checking in a `.tgz`.
 */
export function tarballFromFiles(
  load: () => Promise<{ files: FileTree; mode?: Record<string, number> }>,
): () => Promise<ResolvedTarball> {
  return memo(async () => {
    const { files, mode } = await load();
    const built = buildTarball(files, { mode });
    return {
      bytes: built.bytes,
      fileCount: built.fileCount,
      unpackedSize: built.unpackedSize,
      ...computeIntegrity(built.bytes),
    };
  });
}

/** npm's CouchDB-style `_rev` string. */
export function revString(record: PackageRecord): string {
  return `${record.rev}-${Bun.hash(record.name).toString(16)}`;
}

/**
 * Sorts versions with `Bun.semver.order`. Used both for deterministic
 * packument key order and for the implicit `latest` tag.
 */
export function sortedVersions(record: PackageRecord): Version[] {
  return [...record.versions.keys()].sort(Bun.semver.order);
}

function isPrerelease(version: Version): boolean {
  // A prerelease is a `-` in the version core. Build metadata (`+…`)
  // may itself contain hyphens (`2.0.0+build-7` is a stable release),
  // so it has to be cut off first.
  const plus = version.indexOf("+");
  return (plus === -1 ? version : version.slice(0, plus)).includes("-");
}

/**
 * The effective dist-tags for a record. If `latest` was never set
 * explicitly — the common case for fixtures — it defaults to the highest
 * non-prerelease version, falling back to the highest version. npm
 * itself sets `latest` to the last *published* version, but "highest
 * stable" is what every fixture author means; the handful that mean
 * something else set it explicitly.
 */
export function effectiveDistTags(record: PackageRecord): Record<string, Version> {
  const tags = { ...record.distTags };
  if (!tags.latest && record.versions.size > 0) {
    const ordered = sortedVersions(record);
    tags.latest = ordered.findLast(v => !isPrerelease(v)) ?? ordered[ordered.length - 1]!;
  }
  return tags;
}

/**
 * The version's effective publish time: an explicit `record.time[v]` when
 * parseable, otherwise the deterministic `EPOCH + index minutes` slot. An
 * unparseable explicit value (`"whenever"`) falls back rather than yielding
 * NaN, which would throw from `.toISOString()` on the read path.
 */
function versionTime(record: PackageRecord, version: string, index: number): number {
  const parsed = Date.parse(record.time[version] ?? "");
  return Number.isNaN(parsed) ? EPOCH + index * VERSION_TIME_STEP_MS : parsed;
}

/** The newest version's publish time, ignoring any explicit `modified`. */
function latestVersionTime(record: PackageRecord): number {
  const ordered = sortedVersions(record);
  let latest = EPOCH;
  for (let i = 0; i < ordered.length; i++) {
    const ms = versionTime(record, ordered[i]!, i);
    if (ms > latest) latest = ms;
  }
  return latest;
}

/**
 * The effective `time` document. Versions without an explicit timestamp
 * are assigned `EPOCH + index minutes` in semver order.
 */
export function effectiveTime(record: PackageRecord): Record<string, string> {
  const ordered = sortedVersions(record);
  const time: Record<string, string> = {};
  for (let i = 0; i < ordered.length; i++) {
    time[ordered[i]!] = new Date(versionTime(record, ordered[i]!, i)).toISOString();
  }
  time.created = record.time.created ?? new Date(EPOCH).toISOString();
  time.modified = record.time.modified ?? new Date(latestVersionTime(record)).toISOString();
  return time;
}

/**
 * Records a write: bumps `_rev` and advances `time.modified`. Every write
 * changes the body, so `modified` must step strictly past its previous value
 * or `If-Modified-Since` answers a stale 304 for a changed document. `#write`
 * primes `time.modified` from the pre-mutation record so the clamp sees the
 * value the client observed, even on a record's first write (where an
 * unpublish would otherwise derive it from the already-shrunk version set).
 */
export function touchRecord(record: PackageRecord): void {
  record.rev += 1;
  // An unparseable explicit value parses to NaN and is ignored rather than
  // throwing `RangeError: Invalid Date` out of the write path. The step is one
  // second (HTTP-date resolution): enough to move the `Last-Modified` header,
  // and a publish whose wall-clock version time already advanced past the
  // floor takes that time, not the floor, so `Last-Modified` is not pushed
  // into the future (RFC 9110 8.8.2.1).
  const previous = Date.parse(record.time.modified ?? "");
  const floor = (Number.isNaN(previous) ? -Infinity : previous) + 1000;
  record.time.modified = new Date(Math.max(latestVersionTime(record), floor)).toISOString();
}
