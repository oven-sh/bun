/**
 * Types shared across the registry implementation.
 *
 * Naming follows the npm registry documentation:
 *   - "packument" is the registry document for a package (`GET /:name`).
 *   - "manifest" is one entry under `versions` (a published package.json
 *     plus the registry-added `dist` object).
 *
 * References:
 *   https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
 *   https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
 */

/** A semver string, e.g. `"1.2.3"` or `"1.0.0-beta.4"`. */
export type Version = string;

/** A dist-tag name, e.g. `"latest"` or `"beta"`. */
export type DistTag = string;

/** Contents of a file inside a package tarball. */
export type FileContents = string | Uint8Array;

/**
 * The files that make up a package, keyed by path relative to the package
 * root (what ends up under `package/` in the tarball). `package.json` is
 * always present; the registry fills it in when the caller omits it.
 */
export type FileTree = Record<string, FileContents>;

/**
 * The `dist` object a registry attaches to every published version.
 * The registry is the source of truth for these; they are never read from
 * a fixture's package.json.
 */
export interface Dist {
  /** Subresource-integrity string: `sha512-<base64 of sha512(tarball)>`. */
  integrity: string;
  /** Lowercase hex sha1 of the tarball. Legacy, still emitted by npm. */
  shasum: string;
  /** Absolute URL to the tarball on this registry. */
  tarball: string;
  /** Number of entries in the tarball. */
  fileCount?: number;
  /** Sum of the uncompressed sizes of the tarball's entries, in bytes. */
  unpackedSize?: number;
}

/**
 * A published version as it appears under `versions[v]` in the full
 * packument: the package.json the author published, plus registry fields.
 *
 * This is intentionally an open record. Tests exercise many package.json
 * fields and the registry must round-trip all of them.
 */
export interface VersionManifest {
  name: string;
  version: Version;
  dist: Dist;

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

  /** Deprecation message. An empty string is meaningful (it clears one). */
  deprecated?: string;

  /** Registry identifier, `"<name>@<version>"`. */
  _id?: string;
  /** `true` when the version shipped an `npm-shrinkwrap.json`. */
  _hasShrinkwrap?: boolean;

  [key: string]: unknown;
}

/**
 * The subset of {@link VersionManifest} served for
 * `Accept: application/vnd.npm.install-v1+json` (the "corgi" document).
 * See https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md#abbreviated-version-object
 */
export interface AbbreviatedVersionManifest {
  name: string;
  version: Version;
  dist: Dist;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: string[] | boolean;
  bundledDependencies?: string[] | boolean;
  bin?: string | Record<string, string>;
  directories?: { bin?: string };
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  deprecated?: string;
  funding?: unknown;
  /**
   * Set by the registry, never by the publisher: true when the version has
   * an `install`, `preinstall`, or `postinstall` script.
   */
  hasInstallScript?: boolean;
  _hasShrinkwrap?: boolean;
}

/** The full packument: `GET /:name` with `Accept: application/json`. */
export interface Packument {
  _id: string;
  _rev: string;
  name: string;
  "dist-tags": Record<DistTag, Version>;
  versions: Record<Version, VersionManifest>;
  time: Record<string, string> & { created?: string; modified?: string };
  description?: string;
  readme?: string;
  maintainers?: Array<{ name: string; email?: string }>;
  users?: Record<string, boolean>;
  [key: string]: unknown;
}

/** The abbreviated packument served for `install-v1+json`. */
export interface AbbreviatedPackument {
  name: string;
  modified: string;
  "dist-tags": Record<DistTag, Version>;
  versions: Record<Version, AbbreviatedVersionManifest>;
}

/**
 * The body of `PUT /:name` as sent by `npm publish` / `bun publish`.
 * The same endpoint also receives metadata-only updates (deprecate,
 * legacy dist-tag writes, legacy unpublish), which have no `_attachments`.
 */
export interface PublishBody {
  _id: string;
  name: string;
  description?: string;
  "dist-tags": Record<DistTag, Version>;
  versions: Record<Version, VersionManifest>;
  readme?: string;
  access?: "public" | "restricted" | null;
  _attachments?: Record<
    string,
    {
      content_type: string;
      /** Base64-encoded tarball bytes. */
      data: string;
      length: number;
    }
  >;
}

/** The npm error envelope. Every non-2xx response body uses this shape. */
export interface NpmErrorBody {
  error: string;
  /** Set on some responses (e.g. auth failures) to a short machine code. */
  reason?: string;
}

/** A registered user. */
export interface RegistryUser {
  name: string;
  password: string;
  email: string;
  /**
   * When set, publishes by this user must carry an `npm-otp` header equal
   * to one of these values. Simulates an account with 2FA enabled.
   */
  otp?: string[];
}

/** An issued bearer token. */
export interface RegistryToken {
  token: string;
  user: string;
  readonly_?: boolean;
  created: string;
}
