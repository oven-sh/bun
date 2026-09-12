// The repo's Rust sources, parsed, for source lints.
//
//   import { rustSources } from "./rust-sources.ts";
//
//   for (const src of rustSources({ scope: ["src/jsc/"] })) {
//     for (const call of src.file.find("Call")) {
//       ...
//       offenders.push(`${src.file.location(call)}: ${src.file.text(call)}`);
//     }
//   }
//
// Parsing is lazy and cached for the process. `bun test` runs every lint in
// one process, so the tree is parsed once, by whichever lint runs first.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { parseRust, type RustFile } from "../../../scripts/rust-parser/index.ts";

export const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

export interface RustSource {
  /** Repo-relative path with forward slashes, e.g. `src/jsc/VirtualMachine.rs`. */
  readonly path: string;
  readonly abs: string;
  /** Parsed file. Parsing happens on first access and is cached. */
  readonly file: RustFile;
  /** The file's text. */
  readonly text: string;
}

export interface RustSourceFilter {
  /** Keep only files under these repo-relative directories (`src/jsc/`) or with these exact paths. */
  scope?: readonly string[];
  /** Drop files under these directories or with these exact paths. */
  exclude?: readonly string[];
}

class Source implements RustSource {
  private parsed: RustFile | null = null;
  private content: string | null = null;

  constructor(
    readonly path: string,
    readonly abs: string,
  ) {}

  get text(): string {
    if (this.content === null) this.content = readFileSync(this.abs, "utf8");
    return this.content;
  }

  get file(): RustFile {
    if (this.parsed === null) {
      this.parsed = parseRust(this.text, this.path);
      // Parsing leaves the file's token array behind as garbage. A collection
      // every few dozen files keeps the process near the size of the retained
      // trees (about 700 MB for the whole tree) instead of twice that.
      if (++parsedCount % 50 === 0) Bun.gc(false);
    }
    return this.parsed;
  }
}

let parsedCount = 0;

let all: Source[] | null = null;

function loadAll(): Source[] {
  if (all !== null) return all;
  // Only files tracked in HEAD: a `git stash` round-trip or an editor can leave
  // stray `.rs` files in the working tree. CI runs on a clean checkout, so
  // every real file is covered. Without git, scan everything.
  const ls = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  const tracked = ls.success ? new Set(ls.stdout.toString().split("\0").filter(Boolean)) : null;

  const out: Source[] = [];
  for (const abs of globAllSources().rust) {
    if (!abs.endsWith(".rs")) continue;
    const rel = path.relative(repoRoot, abs).replaceAll(path.sep, "/");
    // `src/cli` is a symlink into `src/runtime/cli`; count each file once
    // under its canonical path.
    if (path.relative(repoRoot, realpathSync(abs)).replaceAll(path.sep, "/") !== rel) continue;
    if (tracked !== null && !tracked.has(rel)) continue;
    out.push(new Source(rel, abs));
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  all = out;
  return out;
}

function matches(rel: string, entries: readonly string[]): boolean {
  return entries.some(e => (e.endsWith("/") ? rel.startsWith(e) : rel === e));
}

/**
 * Every tracked `.rs` file under `src/`, sorted by path. The list is never
 * empty: the glob asserts that the pattern matched something.
 */
export function rustSources(filter: RustSourceFilter = {}): RustSource[] {
  let list: RustSource[] = loadAll();
  if (filter.scope) list = list.filter(s => matches(s.path, filter.scope!));
  if (filter.exclude) list = list.filter(s => !matches(s.path, filter.exclude!));
  return list;
}

/**
 * Per-file counts against an allowlist of documented exceptions. Returns the
 * findings that exceed a file's budget, and the files whose budget is no
 * longer fully used (the ratchet: lower the entry so the shape cannot creep
 * back in). A file over its budget is reported through `offenders` only.
 */
export function ratchet(
  findings: readonly { path: string; message: string }[],
  allow: Readonly<Record<string, number>>,
): { offenders: string[]; stale: string[] } {
  const counts: Record<string, number> = {};
  const offenders: string[] = [];
  for (const f of findings) {
    counts[f.path] = (counts[f.path] ?? 0) + 1;
    if (counts[f.path] > (allow[f.path] ?? 0)) offenders.push(f.message);
  }
  const stale: string[] = [];
  for (const [file, budget] of Object.entries(allow)) {
    const count = counts[file] ?? 0;
    if (count < budget) stale.push(`${file}: allowlisted for ${budget}, found ${count}`);
  }
  return { offenders, stale };
}
