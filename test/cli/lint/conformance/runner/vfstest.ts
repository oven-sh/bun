// Port of the read side of internal/vfs/vfstest/vfstest.go behind iovfs/iofs.go and vfs/internal/internal.go of typescript-go 89d5d5b.
import { compareStringsCaseSensitive } from "./stringutil";
import {
  getCanonicalFileName,
  getEncodedRootLength,
  isRootedDiskPath,
  normalizePath,
  removeTrailingDirectorySeparator,
} from "./tspath";

export type MemEntry =
  | { kind: "file"; data: Uint8Array; realpath: string }
  | { kind: "dir"; realpath: string }
  | { kind: "symlink"; target: string; realpath: string };

export type MemInput = { kind: "file"; data: Uint8Array } | { kind: "symlink"; target: string };

export interface Entries {
  files: string[];
  directories: string[];
  symlinks: Set<string>;
}

// What following links from a canonical path gives: the entry, the canonical path where the walk ended, and the link that led nowhere.
export interface Followed {
  entry: MemEntry | undefined;
  path: string;
  broken: boolean;
  from: string;
  to: string;
}

// A panic of the reference: the caller makes it a status of the instance.
export class MemFsPanic extends Error {}

// The reference follows links without a bound and overflows its stack on a cycle; a longer chain reads as a broken link here.
const maxLinks = 64;

// The %q of the panic messages; a character that Go does not print is escaped by Go and may not be by JSON.
function quote(s: string): string {
  return JSON.stringify(s);
}

// vfstest.go:187
function comparePathsByParts(a: string, b: string): number {
  for (;;) {
    const ai = a.indexOf("/");
    const bi = b.indexOf("/");
    if (ai < 0 || bi < 0) return compareStringsCaseSensitive(a, b);
    const r = compareStringsCaseSensitive(a.slice(0, ai), b.slice(0, bi));
    if (r !== 0) return r;
    a = a.slice(ai + 1);
    b = b.slice(bi + 1);
  }
}

function cutSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

// path.Clean of Go: no empty element and no ".", a ".." takes the element before it, and an empty result is ".".
function pathClean(path: string): string {
  if (path === "") return ".";
  const rooted = path[0] === "/";
  const out: string[] = [];
  let dotdot = 0;
  for (const element of path.split("/")) {
    if (element === "" || element === ".") continue;
    if (element !== "..") out.push(element);
    else if (out.length > dotdot) out.pop();
    else if (!rooted) dotdot = out.push("..");
  }
  if (rooted) return "/" + out.join("/");
  return out.length === 0 ? "." : out.join("/");
}

// path.Dir of Go
function pathDir(path: string): string {
  return pathClean(path.slice(0, path.lastIndexOf("/") + 1));
}

// fs.ValidPath of Go: "." or elements that are neither empty nor "." nor ".."
function validPath(name: string): boolean {
  if (!name.isWellFormed()) return false;
  if (name === ".") return true;
  for (const element of name.split("/")) {
    if (element === "" || element === "." || element === "..") return false;
  }
  return true;
}

export class MemFs {
  // keys are canonical paths without the leading slash
  readonly m = new Map<string, MemEntry>();
  readonly symlinks = new Map<string, string>();

  // FromMapWithClock and convertMapFS
  constructor(
    input: Map<string, MemInput>,
    readonly useCaseSensitiveFileNames: boolean,
  ) {
    let posix = false;
    let windows = false;
    const checkPath = (p: string) => {
      if (!isRootedDiskPath(p)) throw new MemFsPanic(`non-rooted path ${quote(p)}`);
      if (removeTrailingDirectorySeparator(normalizePath(p)) !== p) {
        throw new MemFsPanic(`non-normalized path ${quote(p)}`);
      }
      if (p.startsWith("/")) posix = true;
      else windows = true;
    };
    const mfs = new Map<string, MemInput>();
    for (const p of [...input.keys()].sort(comparePathsByParts)) {
      let f = input.get(p)!;
      checkPath(p);
      if (f.kind === "symlink") {
        checkPath(f.target);
        f = { kind: "symlink", target: cutSlash(f.target) };
      }
      mfs.set(cutSlash(p), f);
    }
    if (posix && windows) throw new MemFsPanic("mixed posix and windows paths");

    // The reference walks its map in no fixed order here: with more than one such pair, the pair it names varies.
    const canonicalPaths = new Map<string, string>();
    for (const path of mfs.keys()) {
      const canonical = this.canonical(path);
      const other = canonicalPaths.get(canonical);
      if (other !== undefined) {
        const [x, y] = [path, other].sort(compareStringsCaseSensitive);
        throw new MemFsPanic(`duplicate path: ${quote(x)} and ${quote(y)} have the same canonical path`);
      }
      canonicalPaths.set(canonical, path);
    }
    for (const p of [...mfs.keys()].sort(comparePathsByParts)) {
      const file = mfs.get(p)!;
      const dir = dirName(p);
      if (dir !== "") {
        const err = this.mkdirAll(dir);
        if (err !== undefined) {
          throw new MemFsPanic(`failed to create intermediate directories for ${quote(p)}: ${err}`);
        }
      }
      this.setEntry(
        p,
        this.canonical(p),
        file.kind === "file"
          ? { kind: "file", data: file.data, realpath: p }
          : { kind: "symlink", target: file.target, realpath: p },
      );
    }
  }

  canonical(p: string): string {
    return getCanonicalFileName(p, this.useCaseSensitiveFileNames);
  }

  private setEntry(realpath: string, canonical: string, entry: MemEntry): void {
    if (realpath === "" || canonical === "") throw new MemFsPanic("empty path");
    this.m.set(canonical, { ...entry, realpath });
    if (entry.kind === "symlink") this.symlinks.set(canonical, this.canonical(entry.target));
  }

  // vfstest.go:261; the Go map walk over symlinks has no fixed order, here it is insertion order
  getFollowingSymlinks(p: string, from = "", to = "", depth = 0): Followed {
    if (depth > maxLinks) return { entry: undefined, path: p, broken: true, from, to };
    const file = this.m.get(p);
    if (file !== undefined && file.kind !== "symlink") return { entry: file, path: p, broken: false, from: "", to: "" };
    const target = this.symlinks.get(p);
    if (target !== undefined) return this.getFollowingSymlinks(target, p, target, depth + 1);
    for (const [other, t] of this.symlinks) {
      if (other.length < p.length && other === p.slice(0, other.length) && p[other.length] === "/") {
        return this.getFollowingSymlinks(t + p.slice(other.length), other, t, depth + 1);
      }
    }
    return { entry: undefined, path: p, broken: from !== "", from, to };
  }

  // vfstest.go:325; undefined stands for a nil error
  private mkdirAll(p: string): string | undefined {
    if (p === "") throw new MemFsPanic("empty path");
    const fast = this.getFollowingSymlinks(this.canonical(p));
    if (fast.entry !== undefined) {
      if (fast.entry.kind !== "dir") return `mkdir ${quote(p)}: path exists but is not a directory`;
      return undefined;
    }
    let toCreate: string[] = [];
    let offset = 0;
    let restarts = 0;
    for (;;) {
      const idx = p.indexOf("/", offset);
      const dir = idx < 0 ? p : p.slice(0, idx);
      const rest = idx < 0 ? "" : p.slice(idx + 1);
      const canonical = this.canonical(dir);
      const r = this.getFollowingSymlinks(canonical);
      if (r.entry === undefined) {
        if (r.broken) return `broken symlink ${quote(r.from)} -> ${quote(r.to)}`;
        toCreate.push(dir);
      } else {
        if (r.entry.kind !== "dir") return `mkdir ${quote(r.path)}: path exists but is not a directory`;
        if (canonical !== r.path) {
          // The reference starts again without a bound, and never ends when links lead back to the directory.
          if (++restarts > maxLinks) return `more than ${maxLinks} linked directories on the way to ${quote(p)}`;
          p = r.entry.realpath + "/" + rest;
          toCreate = [];
          offset = 0;
          continue;
        }
      }
      if (rest === "") break;
      offset = dir.length + 1;
    }
    for (const dir of toCreate) this.setEntry(dir, this.canonical(dir), { kind: "dir", realpath: dir });
    return undefined;
  }

  // internal.go:30
  private split(path: string): { root: string; rest: string } {
    const p = normalizePath(path);
    const l = getEncodedRootLength(p);
    if (l === 0) throw new MemFsPanic(`vfs: path ${quote(p)} is not absolute`);
    const rootLength = l < 0 ? ~l : l;
    return { root: p.slice(0, rootLength), rest: removeTrailingDirectorySeparator(p.slice(rootLength)) };
  }

  // internal.go:38 and iofs.go:109: the name below "/", which is "." for the root itself; undefined when the root has no file system
  private key(path: string): string | undefined {
    const { root, rest } = this.split(path);
    if (root === "/") return rest === "" ? "." : rest;
    const sub = removeTrailingDirectorySeparator(root);
    if (!validPath(sub)) {
      if (getEncodedRootLength(root) < 0) return undefined;
      throw new MemFsPanic(`vfs: failed to create sub file system for ${quote(sub)}: sub ${sub}: invalid argument`);
    }
    return rest === "" ? sub : sub + "/" + rest;
  }

  // resolveSymlinks of testing/fstest since Go 1.25: a link on the way is read again, its target taken from the directory of the link
  private resolveSymlinks(name: string, depth: number): string | undefined {
    if (depth > maxLinks) return undefined;
    const file = this.m.get(name);
    if (file !== undefined && file.kind === "symlink") {
      if (file.target.startsWith("/")) return undefined;
      return this.resolveSymlinks(pathClean(pathDir(name) + "/" + file.target), depth + 1);
    }
    for (let i = 0; i < name.length; i++) {
      const j = name.indexOf("/", i);
      const dir = j < 0 ? name : name.slice(0, j);
      i = j < 0 ? name.length : j;
      const parent = this.m.get(dir);
      if (parent !== undefined && parent.kind === "symlink") {
        if (parent.target.startsWith("/")) return undefined;
        return this.resolveSymlinks(pathClean(pathDir(dir) + "/" + parent.target) + name.slice(i), depth + 1);
      }
    }
    return validPath(name) ? name : undefined;
  }

  // MapFS.Open of vfstest.go:428 over MapFS.Open of testing/fstest: the canonical path of the entry that a name opens
  private open(name: string): string | undefined {
    const cp = this.getFollowingSymlinks(this.canonical(name)).path;
    return validPath(cp) ? this.resolveSymlinks(cp, 0) : undefined;
  }

  stat(path: string): MemEntry | undefined {
    const k = this.key(path);
    if (k === undefined) return undefined;
    if (k === ".") return { kind: "dir", realpath: "." };
    const real = this.open(k);
    return real === undefined ? undefined : this.m.get(real);
  }

  fileExists(path: string): boolean {
    const s = this.stat(path);
    return s !== undefined && s.kind !== "dir";
  }

  directoryExists(path: string): boolean {
    const s = this.stat(path);
    return s !== undefined && s.kind === "dir";
  }

  // The bytes of the file; ReadFile of internal.go:144 decodes them, which is decodeBytes of vfs.ts
  readFile(path: string): Uint8Array | undefined {
    const s = this.stat(path);
    return s !== undefined && s.kind === "file" ? s.data : undefined;
  }

  // iofs.go:190 with vfstest.go:470
  realpath(path: string): string {
    const { root, rest } = this.split(path);
    const joined = root + rest;
    const hadSlash = joined.startsWith("/");
    const r = this.getFollowingSymlinks(this.canonical(cutSlash(joined)));
    if (r.entry === undefined) return path;
    return hadSlash ? "/" + r.entry.realpath : r.entry.realpath;
  }

  // internal.go:68; the entries of a directory come sorted by name
  getAccessibleEntries(path: string): Entries {
    const result: Entries = { files: [], directories: [], symlinks: new Set() };
    const k = this.key(path);
    if (k === undefined) return result;
    let dirKey = "";
    if (k !== ".") {
      const real = this.open(k);
      const dir = real === undefined ? undefined : this.m.get(real);
      if (dir === undefined || dir.kind !== "dir") return result;
      dirKey = real + "/";
    }
    const children: MemEntry[] = [];
    const names = new Set<string>();
    const need = new Set<string>();
    for (const [key, entry] of this.m) {
      if (!key.startsWith(dirKey)) continue;
      const tail = key.slice(dirKey.length);
      const slash = tail.indexOf("/");
      if (slash >= 0) need.add(tail.slice(0, slash));
      else {
        names.add(tail);
        children.push(entry);
      }
    }
    // A name with entries below it and none of its own is a directory that testing/fstest makes up, and vfstest.go:420 panics on it.
    const madeUp = [...need].filter(name => !names.has(name)).sort(compareStringsCaseSensitive);
    if (madeUp.length > 0) {
      throw new MemFsPanic(`unexpected synthesized dir: ${quote(madeUp[0] === "" ? "." : madeUp[0])}`);
    }
    // io/fs.ReadDir sorts by the name of the entry, which is the last element of the real path
    children.sort((a, b) => compareStringsCaseSensitive(baseName(a.realpath), baseName(b.realpath)));
    for (const entry of children) {
      const name = baseName(entry.realpath);
      if (entry.kind === "dir") result.directories.push(name);
      else if (entry.kind === "file") result.files.push(name);
      else {
        const st = this.stat(path + "/" + name);
        if (st === undefined) continue;
        if (st.kind === "dir") result.directories.push(name);
        else if (st.kind === "file") result.files.push(name);
        else continue;
        result.symlinks.add(name);
      }
    }
    return result;
  }
}
