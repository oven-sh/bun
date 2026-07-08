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
 * Conventions match `npm pack` (node-tar with `portable: true`):
 *   - every path lives under `package/`
 *   - uid/gid are 0, uname/gname are empty
 *   - mtime is the fixed epoch node-tar uses for reproducible archives
 *   - entries are sorted, `package/package.json` first
 *
 * Extraction goes the other way (reading a prebuilt fixture `.tgz`) and
 * uses `Bun.Archive`, which also serves as a cross-check that what we
 * write is readable by an independent implementation.
 */

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
 * Writes a numeric field as zero-padded octal terminated by NUL, the
 * POSIX.1-1988 encoding every tar reader accepts.
 */
function putOctal(block: Uint8Array, offset: number, width: number, value: number): void {
  putString(block, offset, value.toString(8).padStart(width - 1, "0") + "\0");
}

/**
 * Splits a path into ustar's `prefix` + `name` fields when it does not fit
 * in the 100-byte `name` field alone. The split must land on a `/` so that
 * `prefix + "/" + name` reconstructs the original path.
 */
function splitName(path: string): { name: string; prefix: string } {
  const bytes = encoder.encode(path);
  if (bytes.length <= 100) return { name: path, prefix: "" };
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

/** Builds one 512-byte ustar header. */
function header(path: string, size: number, mode: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const { name, prefix } = splitName(path);
  putString(block, Field.name, name);
  putOctal(block, Field.mode, 8, mode);
  putOctal(block, Field.uid, 8, 0);
  putOctal(block, Field.gid, 8, 0);
  putOctal(block, Field.size, 12, size);
  putOctal(block, Field.mtime, 12, PORTABLE_MTIME);
  block[Field.typeflag] = "0".charCodeAt(0);
  putString(block, Field.magic, "ustar\0");
  putString(block, Field.version, "00");
  putString(block, Field.prefix, prefix);
  // The checksum is the byte sum of the header with the 8-byte chksum
  // field itself counted as spaces. It is stored as 6 octal digits, NUL,
  // then a space (the one numeric field with its own terminator rule).
  let sum = 8 * 0x20;
  for (let i = 0; i < BLOCK; i++) sum += block[i]!;
  putString(block, Field.chksum, sum.toString(8).padStart(6, "0") + "\0 ");
  return block;
}

function toBytes(contents: string | Uint8Array): Uint8Array {
  return typeof contents === "string" ? encoder.encode(contents) : contents;
}

/** `true` when a file's contents start with a `#!` shebang line. */
function hasShebang(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21;
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
 * `package/` prefix is added here. `executable` paths (and any file that
 * starts with a shebang) are written with mode 0755 so `bin` entries work
 * when extracted on POSIX.
 *
 * The output is byte-for-byte deterministic for a given input.
 */
export function buildTarball(files: FileTree, options: { executable?: Iterable<string> } = {}): BuiltTarball {
  const executable = new Set(options.executable ?? []);
  // package.json first (npm's convention: streaming consumers can stop
  // after the first entry), then the rest in lexicographic order.
  const paths = Object.keys(files).sort((a, b) => {
    if (a === "package.json") return -1;
    if (b === "package.json") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const blocks: Uint8Array[] = [];
  let unpackedSize = 0;
  for (const path of paths) {
    if (path.length === 0 || path.startsWith("/") || path.split("/").includes("..")) {
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
    const mode = executable.has(path) || hasShebang(bytes) ? 0o755 : 0o644;
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

  // Bun's gzip writes mtime=0 and OS=255 in the gzip header, so the only
  // nondeterminism risk is the compressor itself changing across releases.
  return { bytes: Bun.gzipSync(tar, { level: 9 }), fileCount: paths.length, unpackedSize };
}

/**
 * Reads a `.tgz` into a file tree, with paths relative to the package
 * root (the leading `package/` component — or whatever single root
 * directory the archive uses — is stripped, matching npm's extraction).
 */
export async function readTarball(tgz: Uint8Array): Promise<{ files: FileTree; stats: TarballStats }> {
  const entries = await new Bun.Archive(tgz).files();
  const files: FileTree = {};
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
