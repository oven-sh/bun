/**
 * On-disk package fixtures.
 *
 * A fixture tree is a directory of packages laid out the way every npm
 * registry stores them (and the way npm caches them): one directory per
 * package, with scoped packages nested under their `@scope` directory.
 *
 * Inside a package directory, each version is one of:
 *
 *   - `<basename>-<version>.tgz` — a prebuilt tarball. The packument
 *     entry (dependencies, bin, scripts, …) is read out of the
 *     tarball's own `package.json`, and `dist.integrity` is computed
 *     from the bytes. Nothing else needs to be checked in.
 *
 *   - `<version>/` — a directory holding the package's files, with a
 *     `package.json` at its root. The registry packs it into a
 *     deterministic tarball on first request. This is the preferred
 *     format: readable, diffable, no binary blobs in git, and no tool
 *     to run when adding or editing a fixture.
 *
 * An optional `_registry.json` next to the versions holds the few
 * things that are registry state rather than package contents:
 * non-default `dist-tags`, explicit `time` entries, and any extra
 * top-level packument fields. Almost no package needs one.
 *
 * Loading is lazy and cached at module scope: enumerating the tree is
 * one `readdir` per scope, a package is only opened when a client asks
 * for it, and every registry instance pointed at the same directory
 * shares everything. Fixture records are therefore immutable; the
 * registry copies one before letting a publish mutate it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { binModeMap } from "./define";
import { normalizeManifest } from "./normalize";
import {
  createRecord,
  memo,
  tarballFromBytes,
  tarballFromFiles,
  type Manifest,
  type PackageRecord,
  type StoredVersion,
} from "./package-store";
import { readTarball } from "./tar";
import type { FileTree } from "./types";

/** The per-package registry metadata file name. */
const REGISTRY_META = "_registry.json";

/** A lazily-loaded fixture tree rooted at one directory. */
export class FixtureTree {
  readonly root: string;
  /** Package name → absolute package directory, from one eager scan. */
  readonly #dirs = new Map<string, string>();
  readonly #records = new Map<string, PackageRecord>();

  private constructor(root: string) {
    this.root = root;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) {
        // A scope directory: its children are the packages.
        for (const scoped of readdirSync(join(root, entry.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) {
            this.#dirs.set(`${entry.name}/${scoped.name}`, join(root, entry.name, scoped.name));
          }
        }
      } else {
        this.#dirs.set(entry.name, join(root, entry.name));
      }
    }
  }

  static #cache = new Map<string, FixtureTree>();

  /**
   * Opens (or reuses) a fixture tree. The scan and every package loaded
   * from it are shared process-wide, so hundreds of short-lived
   * registries pointed at the same fixtures cost nothing extra.
   */
  static open(dir: string): FixtureTree {
    const root = resolve(dir);
    let tree = FixtureTree.#cache.get(root);
    if (tree === undefined) FixtureTree.#cache.set(root, (tree = new FixtureTree(root)));
    return tree;
  }

  has(name: string): boolean {
    return this.#dirs.has(name);
  }

  names(): string[] {
    return [...this.#dirs.keys()];
  }

  /**
   * Loads a package's record. The record's manifest and tarball thunks
   * are memoized, so repeated packument requests re-read nothing.
   */
  get(name: string): PackageRecord | undefined {
    const cached = this.#records.get(name);
    if (cached !== undefined) return cached;
    const dir = this.#dirs.get(name);
    if (dir === undefined) return undefined;
    const record = loadPackageDir(name, dir);
    this.#records.set(name, record);
    return record;
  }
}

/** `@scope/name` → `name`; an unscoped name is already its own basename. */
function unscoped(name: string): string {
  return name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
}

function loadPackageDir(name: string, dir: string): PackageRecord {
  const record = createRecord(name);
  const tgzPrefix = `${unscoped(name)}-`;
  // `_registry.json`'s `executable`: {"<version>": ["<path>", ...]}. A file's
  // committed 0755 bit cannot be read here (`statSync().mode` has no execute
  // bit on Windows), and only a package's own `bin` targets are inferred, so a
  // bin *target* owned by another package has to say so.
  const executable = readRegistryMeta(join(dir, REGISTRY_META)).executable ?? {};
  const directoryVersions = new Set<string>();

  // `readdirSync` order is filesystem-defined, so the duplicate check
  // has to sit in front of every insertion or it would only catch one
  // of the two enumeration orders.
  const add = (version: string, stored: StoredVersion) => {
    if (record.versions.has(version)) {
      throw new Error(`${dir}: version ${version} is defined by both a .tgz and a directory`);
    }
    record.versions.set(version, stored);
  };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith(tgzPrefix) && entry.name.endsWith(".tgz")) {
      const version = entry.name.slice(tgzPrefix.length, -".tgz".length);
      add(version, prebuiltVersion(name, join(dir, entry.name)));
    } else if (entry.isDirectory()) {
      const version = entry.name;
      if (!isFile(join(dir, version, "package.json"))) continue;
      directoryVersions.add(version);
      add(version, directoryVersion(name, version, join(dir, version), executable[version] ?? []));
    }
  }

  // `executable` only reaches the packer through the directory branch, so a key
  // naming a `.tgz`-backed (or absent) version would be silently ignored.
  for (const version of Object.keys(executable)) {
    if (!directoryVersions.has(version)) {
      throw new Error(
        `${dir}/${REGISTRY_META}: "executable" names version ${JSON.stringify(version)}, which is not a directory fixture`,
      );
    }
  }

  if (record.versions.size === 0) {
    throw new Error(
      `fixture package ${JSON.stringify(name)} at ${dir} has no versions ` +
        `(expected ${tgzPrefix}<version>.tgz files or <version>/ directories)`,
    );
  }

  applyRegistryMeta(record, join(dir, REGISTRY_META));
  return record;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * A version backed by a checked-in `.tgz`. Its manifest is the
 * `package.json` inside the tarball, normalized the way a registry
 * would have at publish time — read lazily, because a packument needs
 * every version's manifest but a tarball download needs none.
 */
function prebuiltVersion(name: string, tgzPath: string): StoredVersion {
  const read = memo(async () => new Uint8Array(await Bun.file(tgzPath).arrayBuffer()));
  return {
    manifest: memo(async () => {
      let files: FileTree;
      try {
        ({ files } = await readTarball(await read()));
      } catch (cause) {
        throw new Error(`failed to read fixture tarball ${tgzPath}`, { cause });
      }
      const raw = files["package.json"];
      if (raw === undefined) throw new Error(`fixture tarball ${tgzPath} has no package.json`);
      return normalizeManifest(name, JSON.parse(Buffer.from(raw).toString()) as Manifest, Object.keys(files));
    }),
    tarball: tarballFromBytes(read),
  };
}

/**
 * A version backed by a directory of source files. The tarball is
 * packed on first request. A file is written at mode 0755 when it is a
 * `bin` target (not `directories.bin`; `npm pack` only reads
 * `pkg.bin`), 0644 otherwise — a pure function of the committed
 * bytes. The on-disk mode is deliberately
 * not consulted: `statSync().mode` never carries an execute bit on
 * Windows, so using it would give the same fixture a different
 * `dist.integrity` per platform.
 */
function directoryVersion(name: string, version: string, versionDir: string, executable: string[]): StoredVersion {
  const manifest = memo(async () => {
    const raw = JSON.parse(readFileSync(join(versionDir, "package.json"), "utf8")) as Manifest;
    // Catch a fixture whose directory name and package.json disagree before
    // it turns into a confusing resolution failure. Build metadata is not
    // part of a version's identity (semver §10) and a registry keys the
    // packument without it, so `1.0.0+123` may live in `1.0.0/`.
    const withoutBuild = (value: unknown) => (typeof value === "string" ? value.split("+")[0] : value);
    for (const [field, expected] of [
      ["name", name],
      ["version", withoutBuild(version)],
    ] as const) {
      const actual = field === "version" ? withoutBuild(raw.version) : raw[field];
      if (raw[field] !== undefined && actual !== expected) {
        throw new Error(
          `${versionDir}/package.json: "${field}" is ${JSON.stringify(raw[field])} ` +
            `but the fixture's location says ${JSON.stringify(expected)}`,
        );
      }
    }
    return normalizeManifest(name, raw, readdirSync(versionDir));
  });
  return {
    manifest,
    tarball: tarballFromFiles(async () => {
      const files = readFileTree(versionDir);
      const mode = binModeMap(await manifest());
      for (const path of executable) {
        if (!(path in files)) throw new Error(`${versionDir}: _registry.json marks a missing file executable: ${path}`);
        mode[path] = 0o755;
      }
      return { files, mode };
    }),
  };
}

/**
 * Reads a directory into an in-memory file tree. Anything other than a
 * regular file or directory is a loud error: git materializes a
 * committed symlink differently per platform (`core.symlinks`), so
 * silently including one — or not — would be the one remaining
 * on-disk input to the packed tarball that is not a pure function of
 * committed bytes.
 */
function readFileTree(root: string): FileTree {
  const files: FileTree = Object.create(null);
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files[path] = readFileSync(join(root, path));
      } else {
        throw new Error(
          `${join(root, path)}: fixture directory may contain only regular files and ` +
            `directories (a committed symlink checks out differently per platform)`,
        );
      }
    }
  };
  walk("");
  return files;
}

interface RegistryMeta {
  executable?: Record<string, string[]>;
}

function readRegistryMeta(path: string): RegistryMeta {
  return isFile(path) ? (JSON.parse(readFileSync(path, "utf8")) as RegistryMeta) : {};
}

/**
 * Applies a package's `_registry.json`, when present. `dist-tags` and
 * `time` map onto the record, `executable` is consumed by `loadPackageDir`,
 * and every other key becomes a top-level packument field.
 */
function applyRegistryMeta(record: PackageRecord, path: string): void {
  if (!isFile(path)) return;
  const meta = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(meta)) {
    if (key === "dist-tags") record.distTags = { ...(value as Record<string, string>) };
    else if (key === "time") record.time = { ...(value as Record<string, string>) };
    else if (key === "executable")
      continue; // consumed by loadPackageDir
    else record.extra[key] = value;
  }
}
