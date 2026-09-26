import { builtinModules } from "node:module";

export interface PackageName {
  /** `@scope/name` or `name`. */
  name: string;
  /** `scope` of `@scope/name`, without the `@`. */
  scope: string | null;
  /** `name` of `@scope/name`. */
  basename: string;
  /** The form clients put in a URL: `@scope%2fname`. */
  escaped: string;
}

const blockedNames = new Set(["node_modules", "favicon.ico"]);
const builtins = new Set(builtinModules.map(name => name.toLowerCase()));

function isUrlSafe(part: string): boolean {
  return encodeURIComponent(part) === part;
}

/**
 * The rules of `validate-npm-package-name` that apply to every name, old and new.
 * A name that passes is also safe as a path below the storage directory: it has at most one `/`, and no part
 * starts with a `.` or holds a `\`, a `:` or a NUL.
 */
export function parsePackageName(name: string): PackageName | null {
  if (typeof name !== "string" || name.length === 0) return null;
  if (name.trim() !== name) return null;
  if (name.startsWith(".") || name.startsWith("_") || name.startsWith("-")) return null;
  if (blockedNames.has(name.toLowerCase())) return null;

  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) return null;
    const scope = name.slice(1, slash);
    const basename = name.slice(slash + 1);
    if (scope.length === 0 || basename.length === 0) return null;
    if (basename.startsWith(".")) return null;
    if (!isUrlSafe(scope) || !isUrlSafe(basename)) return null;
    return { name, scope, basename, escaped: `@${scope}%2f${basename}` };
  }

  if (!isUrlSafe(name)) return null;
  return { name, scope: null, basename: name, escaped: name };
}

/**
 * The rules that the registry adds for a name nobody has published yet.
 * Returns the reason the name is refused, or null when the name is fine.
 */
export function validateNewPackageName(name: string): string | null {
  const parsed = parsePackageName(name);
  if (!parsed) return "name can only contain URL-friendly characters";
  if (name.length > 214) return "name can no longer contain more than 214 characters";
  if (name.toLowerCase() !== name) return "name can no longer contain capital letters";
  if (/[~'!()*]/.test(parsed.basename)) return `name can no longer contain special characters ("~'!()*")`;
  if (builtins.has(name)) return `${name} is a core module name`;
  return null;
}

const numeric = "(?:0|[1-9]\\d*)";
const identifiers = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const prereleaseIdentifier = `(?:${numeric}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;

const versionPattern = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+${identifiers})?$`,
);

/** Strict semver 2.0.0, the form the registry stores. `v1.0.0` and `1.0` do not pass. */
export function isValidVersion(version: unknown): version is string {
  return typeof version === "string" && version.length <= 256 && versionPattern.test(version);
}

const xr = `(?:[xX*]|${numeric})`;
const partial = `[v=\\s]*${xr}(?:\\.${xr}(?:\\.${xr}(?:-?${identifiers})?(?:\\+${identifiers})?)?)?`;
const primitive = `(?:[<>]?=?|~>?|\\^)\\s*${partial}`;
const comparators = `(?:${partial}\\s+-\\s+${partial}|${primitive}(?:\\s+${primitive})*)`;
const rangePattern = new RegExp(`^\\s*(?:${comparators})?\\s*(?:\\|\\|\\s*(?:${comparators})?\\s*)*$`);

/** The grammar of `semver.validRange`: `1`, `1.x`, `^1.2.3`, `>=1 <2`, `1.0.0 - 2.0.0`, `*`, and the empty string. */
export function isValidRange(range: string): boolean {
  return rangePattern.test(range);
}

/** A dist-tag must not read as a version range, or `pkg@<tag>` is ambiguous. This is the rule of `npm dist-tag`. */
export function isValidTag(tag: unknown): tag is string {
  if (typeof tag !== "string" || tag.length === 0 || tag.length > 214) return false;
  // An assignment to this key of an object does not store anything.
  if (tag.trim() !== tag || tag === "__proto__") return false;
  return !isValidRange(tag);
}

/** Orders two versions: negative when `a` is older. Both must pass `isValidVersion`. */
export function compareVersions(a: string, b: string): number {
  return Bun.semver.order(a, b);
}

/** The highest version of the list, or undefined when the list is empty. A prerelease ranks below its release. */
export function highestVersion(versions: Iterable<string>): string | undefined {
  let highest: string | undefined;
  for (const version of versions) {
    if (!isValidVersion(version)) continue;
    if (highest === undefined || compareVersions(version, highest) > 0) highest = version;
  }
  return highest;
}
