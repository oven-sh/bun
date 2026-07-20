/**
 * The normalization `npm publish` applies to a package.json before the
 * manifest reaches the registry. A real registry's `versions[v]` never
 * equals the `package.json` inside the tarball; this is the gap.
 *
 * Only the transformations that affect an installer are implemented:
 *
 *   - `bin` is canonicalized the way `npm-normalize-package-bin` does
 *     it: the string form becomes a map keyed by the package's
 *     unscoped name, keys are reduced to their basename, and targets
 *     are path-normalized under the package root. Installers (and
 *     `bun.lock`) see this form, never the author's.
 *
 *   - a `binding.gyp` with no `install`/`preinstall` script gets the
 *     implicit `scripts.install = "node-gyp rebuild"` plus
 *     `gypfile: true`, matching `read-package-json`.
 *
 * This runs where a package enters the registry *without* going
 * through a real publishing client: `define()` and the fixture
 * loaders. A real `PUT /:name` body is already normalized by the
 * client, so `publish.ts` stores it as-is, like a real registry.
 */

import { posix } from "node:path";
import type { Manifest } from "./package-store";

/** `@scope/name` → `name`; `name` → `name`. */
function unscoped(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/**
 * A path confined to the package root: resolved against `/` (so `./`
 * disappears and `..` cannot escape) with the leading `/` removed.
 */
function containedPath(value: string): string {
  return posix.join("/", value).slice(1);
}

/**
 * `npm-normalize-package-bin`. Returns the canonical `bin` map, or
 * `undefined` when nothing usable remains.
 */
export function normalizeBin(name: string, bin: unknown): Record<string, string> | undefined {
  let entries: Record<string, unknown>;
  if (typeof bin === "string") {
    entries = { [unscoped(name)]: bin };
  } else if (Array.isArray(bin)) {
    entries = Object.fromEntries(bin.filter(b => typeof b === "string").map(b => [posix.basename(b), b]));
  } else if (typeof bin === "object" && bin !== null) {
    entries = bin as Record<string, unknown>;
  } else {
    return undefined;
  }

  const clean: Record<string, string> = {};
  for (const [key, target] of Object.entries(entries)) {
    if (typeof target !== "string") continue;
    // npm treats "\" (and, for keys, ":") as "/" before containing the
    // basename; its only key rejection is the result being empty (".",
    // ".." and ""), so a name like ".dotcmd" is a legal bin.
    const base = containedPath(posix.basename(key.replace(/\\|:/g, "/")));
    const normalized = containedPath(target.replace(/\\/g, "/"));
    if (base.length === 0 || normalized.length === 0) continue;
    clean[base] = normalized;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** An entry `read-package-json` treats as a gyp file: `*.gyp` at the root. */
function hasRootGypFile(rootPaths: Iterable<string>): boolean {
  for (const path of rootPaths) if (path.endsWith(".gyp") && !path.includes("/")) return true;
  return false;
}

/**
 * Produces the manifest a registry would store for a publish of
 * `raw`, given the paths of the files in its tarball (relative to the
 * package root). `raw` is not mutated.
 */
export function normalizeManifest(name: string, raw: Manifest, tarballPaths: Iterable<string>): Manifest {
  const manifest: Manifest = { ...raw };

  if (manifest.bin !== undefined) {
    const bin = normalizeBin(name, manifest.bin);
    if (bin === undefined) delete manifest.bin;
    else manifest.bin = bin;
  }

  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  if (manifest.gypfile !== false && !scripts.install && !scripts.preinstall && hasRootGypFile(tarballPaths)) {
    manifest.scripts = { ...scripts, install: "node-gyp rebuild" };
    manifest.gypfile = true;
  }

  return manifest;
}
