/**
 * A deterministic `.tgz` (gzipped ustar) writer for npm package tarballs.
 *
 * `Bun.Archive` cannot be used here: it stamps the current wall clock into
 * every tar header's mtime, so the same input produces a different archive
 * (and a different `dist.integrity`) on every call. A registry whose
 * integrity strings end up inside lockfiles and test snapshots must be a
 * pure function of its inputs. Writing ustar directly gives us that; the
 * format is a fixed-width 512-byte header per entry and nothing else.
 *
 * The header encoding is byte-for-byte node-tar's with `portable: true`
 * (what `npm pack` produces): every path under `package/`, entries in
 * npm-packlist's sort order, mtime fixed to node-tar's reproducible
 * epoch, uid/gid all-NUL, numeric fields as zero-padded octal + `" \0"`.
 * The independent oracle
 * for that is the `npm pack` golden vectors in `tar.test.ts`, which
 * assert `gunzip(buildTarball(src))` byte-equals `gunzip(npm pack src)`.
 *
 * Extraction goes the other way (reading a prebuilt fixture `.tgz`) and
 * uses `Bun.Archive` — which is bun's own vendored libarchive, the same
 * one `extract_tarball.rs` uses, so it is not an independent check.
 */

import { posix } from "node:path";
import type { FileTree } from "./types";

/**
 * node-tar's fixed timestamp for reproducible archives,
 * 1985-10-26T08:15:00.000Z, in seconds.
 */
const PORTABLE_MTIME = Date.UTC(1985, 9, 26, 8, 15, 0) / 1000;

const BLOCK = 512;
const encoder = new TextEncoder();

/** Byte offsets of the ustar header fields we populate. */
const enum Field {
  name = 0, // 100
  mode = 100, // 8
  uid = 108, // 8
  gid = 116, // 8
  size = 124, // 12
  mtime = 136, // 12
  chksum = 148, // 8
  typeflag = 156, // 1
  magic = 257, // 6
  version = 263, // 2
  devmajor = 329, // 8
  devminor = 337, // 8
  prefix = 345, // 155
}

/**
 * Writes a string into `block` at `offset`, as UTF-8 like node-tar.
 * That is also the unit `splitName` measures the 100/155-byte field
 * limits in, so the validator and the writer can never disagree about
 * a non-ASCII path.
 */
function putString(block: Uint8Array, offset: number, value: string): void {
  block.set(encoder.encode(value), offset);
}

/**
 * Writes a numeric field as node-tar's `padOctal` does: (width-2)
 * zero-padded octal digits + space + NUL, or — when the value already
 * fills width-1 digits — just the digits + NUL.
 */
function putOctal(block: Uint8Array, offset: number, width: number, value: number): void {
  const s = value.toString(8);
  putString(block, offset, s.length === width - 1 ? s + "\0" : s.padStart(width - 2, "0") + " \0");
}

/**
 * node-tar's `mode-fix.js` under `portable: true`, which `npm pack` always is.
 * 0644 and 0755 are fixed points; 0444 packs as 0644 and 0777 as 0755. The
 * `& 0o7777` is also what bounds the octal field: an unmasked mode would run
 * past its 8 bytes and overwrite `uid`/`gid`.
 */
function modeFix(mode: number): number {
  return ((mode & 0o7777) | 0o600) & ~0o22;
}

/**
 * Splits a path into ustar's `prefix` + `name` fields when it does not fit
 * in the 100-byte `name` field alone. The split must land on a `/` so that
 * `prefix + "/" + name` reconstructs the original path.
 */
function splitName(path: string): { name: string; prefix: string } {
  const bytes = encoder.encode(path);
  // node-tar's splitPrefix enters the split branch at exactly 100 too.
  if (bytes.length < 100) return { name: path, prefix: "" };
  // Walk candidate split points from the right so `name` stays as short as
  // the format allows, maximizing room in `prefix`.
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== "/") continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (encoder.encode(name).length <= 100 && encoder.encode(prefix).length <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(
    `tar entry path is too long for the ustar format (${bytes.length} bytes, max 255 with a '/' within the last 100): ${JSON.stringify(path)}`,
  );
}

/** Builds one 512-byte ustar header, byte-identical to node-tar portable. */
function header(path: string, size: number, mode: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const { name, prefix } = splitName(path);
  putString(block, Field.name, name);
  putOctal(block, Field.mode, 8, modeFix(mode));
  // node-tar in portable mode leaves uid/gid as all-NUL bytes.
  putOctal(block, Field.size, 12, size);
  putOctal(block, Field.mtime, 12, PORTABLE_MTIME);
  block[Field.typeflag] = "0".charCodeAt(0);
  putString(block, Field.magic, "ustar\0");
  putString(block, Field.version, "00");
  putOctal(block, Field.devmajor, 8, 0);
  putOctal(block, Field.devminor, 8, 0);
  putString(block, Field.prefix, prefix);
  // The checksum is the byte sum of the header with the 8-byte chksum
  // field itself counted as spaces; encoded like every other numeric.
  let sum = 8 * 0x20;
  for (let i = 0; i < BLOCK; i++) sum += block[i]!;
  putOctal(block, Field.chksum, 8, sum);
  return block;
}

function toBytes(contents: string | Uint8Array): Uint8Array {
  return typeof contents === "string" ? encoder.encode(contents) : contents;
}

/**
 * npm-packlist v9's entry sort, verbatim: extension, then basename, then
 * full path, each case-insensitive under the `en` locale. `tar.test.ts`
 * pins an ordering that exercises all three tiers.
 */
export function npmPacklistSort(a: string, b: string): number {
  return (
    posix.extname(a).toLowerCase().localeCompare(posix.extname(b).toLowerCase(), "en") ||
    posix.basename(a).toLowerCase().localeCompare(posix.basename(b).toLowerCase(), "en") ||
    a.localeCompare(b, "en")
  );
}

export interface TarballStats {
  /** Number of entries written. */
  fileCount: number;
  /** Sum of the uncompressed entry sizes, in bytes. */
  unpackedSize: number;
}

export interface BuiltTarball extends TarballStats {
  /** The gzipped tarball bytes. */
  bytes: Uint8Array;
}

/**
 * Builds a gzipped npm package tarball from an in-memory file tree.
 *
 * Paths in `files` are relative to the package root; the standard
 * `package/` prefix is added here. Every entry is written with mode
 * 0644 unless `options.mode` names an override for it, so a tarball can
 * ship a non-executable bin the way real npm packages published from
 * Windows do. An override goes through {@link modeFix} first.
 *
 * The output is byte-for-byte deterministic for a given input.
 */
export function buildTarball(files: FileTree, options: { mode?: Record<string, number> } = {}): BuiltTarball {
  const modes = options.mode ?? {};
  // npm-packlist's sort: extension, then basename, then full path.
  const paths = Object.keys(files).sort(npmPacklistSort);

  const blocks: Uint8Array[] = [];
  let unpackedSize = 0;
  for (const path of paths) {
    // `""` covers a leading `/`, a trailing `/` (libarchive reads it back as a
    // directory and drops it) and `a//b`. `.` would ship `package/./x`, which
    // `npm pack` normalizes away and which defeats the duplicate-path checks.
    const segments = path.split("/");
    if (path.length === 0 || segments.includes("") || segments.includes(".") || segments.includes("..")) {
      throw new Error(`invalid tarball entry path: ${JSON.stringify(path)}`);
    }
    // The ustar header declares no name encoding, and libarchive (so
    // `Bun.Archive`, and therefore this library's own reader) resolves
    // names through the process locale: under a `C` locale it reads a
    // non-ASCII name back as "". A loud error here beats producing a
    // tarball that silently loses entries when something extracts it.
    if (/[^\x20-\x7e]/.test(path)) {
      throw new Error(`non-ASCII tarball entry path is not supported: ${JSON.stringify(path)}`);
    }
    const bytes = toBytes(files[path]!);
    // Own-property: a file named `toString` must not pick up Object.prototype's.
    const mode = Object.hasOwn(modes, path) ? modes[path]! : 0o644;
    blocks.push(header(`package/${path}`, bytes.length, mode));
    blocks.push(bytes);
    const padding = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
    if (padding !== 0) blocks.push(new Uint8Array(padding));
    unpackedSize += bytes.length;
  }
  // An archive ends with two zero-filled blocks.
  blocks.push(new Uint8Array(BLOCK * 2));

  const tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }

  // zlib writes the build host's OS_CODE at gzip header byte 9 (3 on
  // Linux, 19 on macOS, 10 on Windows), so normalize it to 255
  // ("unknown", node-tar's portable convention) or `dist.integrity`
  // would differ per build platform. With mtime already 0 at offsets
  // 4-7, the only remaining nondeterminism risk is the compressor
  // itself changing across releases; a pinned known-answer sha512 in
  // tar.test.ts is what catches that.
  const bytes = Bun.gzipSync(tar, { level: 9 });
  bytes[9] = 0xff;
  return { bytes, fileCount: paths.length, unpackedSize };
}

/**
 * Reads a `.tgz` into a file tree, with paths relative to the package
 * root (the leading `package/` component — or whatever single root
 * directory the archive uses — is stripped, matching npm's extraction).
 */
export async function readTarball(tgz: Uint8Array): Promise<{ files: FileTree; stats: TarballStats }> {
  const entries = await new Bun.Archive(tgz).files();
  // Null prototype: an entry named `__proto__` must become a key, not a setter.
  const files: FileTree = Object.create(null);
  let unpackedSize = 0;
  for (const [path, blob] of entries) {
    // npm strips exactly one leading path component; real tarballs use
    // `package/`, but npm (and bun) accept any single root directory.
    const slash = path.indexOf("/");
    const relative = slash === -1 ? path : path.slice(slash + 1);
    if (relative.length === 0) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files[relative] = bytes;
    unpackedSize += bytes.length;
  }
  return { files, stats: { fileCount: Object.keys(files).length, unpackedSize } };
}

/**
 * Reads just `package/package.json` out of a `.tgz`. Used to derive
 * packuments from prebuilt fixture tarballs without extracting everything.
 */
export async function readPackageJson(tgz: Uint8Array): Promise<Record<string, unknown>> {
  const entries = await new Bun.Archive(tgz).files();
  for (const [path, blob] of entries) {
    const slash = path.indexOf("/");
    if (path.slice(slash + 1) === "package.json") {
      return JSON.parse(await blob.text());
    }
  }
  throw new Error("tarball has no package.json");
}
