// Shared by the per-file inventories in this directory (dead-code-escapes,
// vm-thread-door, int-cast-expects): which Rust files to scan, and how to
// ignore commented-out code.

import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

export const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

// Only files tracked in HEAD: editors and `git stash` round-trips can leave
// stray `.rs` files in the working tree (e.g. files a branch deletes being
// temporarily restored), and those must not fail an inventory. CI runs against
// the committed tree, so every real file is covered.
function trackedFiles(): Set<string> | null {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
}

/**
 * Every tracked Rust source file, as its repo-relative path (the inventory
 * key) and absolute path, each file once: `src/cli` is a symlink into
 * `src/runtime/cli`, so only the canonical path is reported.
 */
export function trackedRustSources(): { source: string; abs: string }[] {
  const tracked = trackedFiles();
  const out: { source: string; abs: string }[] = [];
  for (const abs of globAllSources().rust) {
    if (!abs.endsWith(".rs")) continue;
    const source = path.relative(repoRoot, abs).replaceAll(path.sep, "/");
    if (path.relative(repoRoot, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
    if (tracked !== null && !tracked.has(source)) continue;
    out.push({ source, abs });
  }
  return out;
}

/** The file with its full-line `//` comments removed, so commented-out code is not counted. */
export function withoutLineComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

/** `counts` as a sorted JSON object, the on-disk shape of every limits file here. */
export function sortedInventory<T>(counts: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
