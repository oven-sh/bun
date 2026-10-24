/**
 * The package metadata document ("packument") and its two wire forms.
 * https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
 */

export interface Human {
  name?: string;
  email?: string;
  url?: string;
}

export interface Dist {
  tarball: string;
  shasum?: string;
  integrity?: string;
  fileCount?: number;
  unpackedSize?: number;
  [key: string]: unknown;
}

export interface VersionDocument {
  name: string;
  version: string;
  dist: Dist;
  deprecated?: string;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export interface Packument {
  _id?: string;
  _rev?: string;
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, VersionDocument>;
  time?: Record<string, string>;
  maintainers?: Human[];
  users?: Record<string, boolean>;
  readme?: string;
  readmeFilename?: string;
  [key: string]: unknown;
}

export const abbreviatedContentType = "application/vnd.npm.install-v1+json";

/**
 * The value under a key that a client chose. A name such as `constructor` is a key of every object through the
 * prototype, and it is not a version or a tag.
 */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * The registry answers with the abbreviated document when the Accept header holds this media type anywhere, in
 * this exact case. It does not weigh q values: `application/json; q=1.0, application/vnd.npm.install-v1+json; q=0.1`
 * gets the abbreviated document too.
 */
export function wantsAbbreviated(accept: string | null): boolean {
  return accept !== null && accept.includes(abbreviatedContentType);
}

/** The allow list of the abbreviated version object, in the order of the registry documentation. */
const abbreviatedVersionFields = [
  "name",
  "version",
  "deprecated",
  "dependencies",
  "acceptDependencies",
  "optionalDependencies",
  "devDependencies",
  "bundleDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "bin",
  "directories",
  "dist",
  "engines",
  "funding",
  "cpu",
  "os",
] as const;

/** Fields that only the storage layer of verdaccio writes. They are not part of a packument on the wire. */
const storageOnlyFields = new Set(["_attachments", "_distfiles", "_uplinks"]);

export function hasInstallScript(version: VersionDocument): boolean {
  if (version.hasInstallScript === true) return true;
  const scripts = version.scripts;
  if (scripts === null || typeof scripts !== "object") return false;
  return Boolean(scripts.preinstall || scripts.install || scripts.postinstall);
}

/** `pkg-1.0.0.tgz` of `http://host/@scope/pkg/-/@scope/pkg-1.0.0.tgz?x=1`. */
export function tarballFilename(version: VersionDocument, fallbackBasename: string): string {
  const tarball = version.dist?.tarball;
  if (typeof tarball === "string" && tarball.length > 0) {
    const end = tarball.search(/[?#]/);
    const path = end === -1 ? tarball : tarball.slice(0, end);
    const filename = path.slice(path.lastIndexOf("/") + 1);
    if (filename.length > 0) return filename;
  }
  return `${fallbackBasename}-${version.version}.tgz`;
}

export interface RenderContext {
  /** The canonical name, which can differ from `name` in a stored document. */
  name: string;
  basename: string;
  /** Origin plus path prefix of the registry as the client addressed it, no trailing slash. */
  base: string;
  /** Used for `modified` when the document has no `time.modified`. */
  modified: Date;
}

function tarballUrl(context: RenderContext, version: VersionDocument): string {
  return `${context.base}/${context.name}/-/${tarballFilename(version, context.basename)}`;
}

export function renderVersion(context: RenderContext, version: VersionDocument): VersionDocument {
  return { ...version, dist: { ...version.dist, tarball: tarballUrl(context, version) } };
}

export function renderFull(context: RenderContext, document: Packument): Packument {
  const rendered: Record<string, unknown> = {};
  for (const key in document) {
    if (storageOnlyFields.has(key)) continue;
    rendered[key] = document[key];
  }
  const versions: Record<string, VersionDocument> = {};
  for (const key in document.versions) {
    versions[key] = renderVersion(context, document.versions[key]);
  }
  rendered.versions = versions;
  return rendered as Packument;
}

export function renderAbbreviated(context: RenderContext, document: Packument) {
  const versions: Record<string, Record<string, unknown>> = {};
  for (const key in document.versions) {
    const version = document.versions[key];
    const abbreviated: Record<string, unknown> = {};
    for (const field of abbreviatedVersionFields) {
      if (field === "dist") {
        abbreviated.dist = { ...version.dist, tarball: tarballUrl(context, version) };
      } else if (field === "bundleDependencies") {
        const bundled = version.bundleDependencies ?? version.bundledDependencies;
        if (bundled !== undefined) abbreviated.bundleDependencies = bundled;
      } else if (version[field] !== undefined) {
        abbreviated[field] = version[field];
      }
    }
    if (version._hasShrinkwrap === true) abbreviated._hasShrinkwrap = true;
    if (hasInstallScript(version)) abbreviated.hasInstallScript = true;
    versions[key] = abbreviated;
  }
  return {
    name: document.name,
    "dist-tags": document["dist-tags"],
    versions,
    modified: document.time?.modified ?? context.modified.toISOString(),
  };
}
