import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `bun_sys::Error` stores its errno as a discriminant of bun's own `E` table
// (`bun_errno`). On POSIX that table mirrors the host's errno numbers, so a
// `libc::E*` constant happens to be the right value. On Windows it does not:
// the `libc` crate carries the MSVC CRT's numbering there while `E` keeps
// Linux numbering, and the two diverge from the mid 30s on (`libc::ENAMETOOLONG`
// is 38, which `E` decodes as ENOSYS; `libc::ENOSYS` is 40, decoded as ELOOP;
// `libc::ENOTSUP` is 129, decoded as EKEYREJECTED). An errno that is known at
// compile time therefore has to be spelled with bun's enum, which is correct on
// every target:
//
//   Error::from_code_int(libc::ENAMETOOLONG, tag)  ->  Error::from_code(E::ENAMETOOLONG, tag)
//   Error::new(libc::ENOSYS, tag)                  ->  Error::from_code(E::ENOSYS, tag)
//
// `from_code_int` / `Error::new` remain the right constructors for an errno read
// back from a syscall at runtime, which is what this lint leaves alone.

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// the other lints in this directory.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const BANNED: RegExp[] = [/\bfrom_code_int\(\s*libc::E\w*/g, /\bError::new\(\s*libc::E\w*/g];

let scanned = 0;
const offenders: string[] = [];
for (const abs of globAllSources().rust) {
  if (!abs.endsWith(".rs")) continue;
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  // Blank out full-line comments so prose mentions of the pattern don't count.
  // `[ \t]*` rather than `\s*` so the newlines stay and line numbers below
  // stay right.
  const content = (await file(abs).text()).replace(/^[ \t]*\/\/.*$/gm, "");
  scanned++;
  const found: { line: number; text: string }[] = [];
  for (const re of BANNED) {
    for (const match of content.matchAll(re)) {
      found.push({
        line: content.slice(0, match.index).split("\n").length,
        text: match[0].replace(/\s+/g, " "),
      });
    }
  }
  found.sort((a, b) => a.line - b.line);
  offenders.push(...found.map(({ line, text }) => `${source}:${line}: ${text}`));
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertion below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("bun_sys::Error is never built from a libc errno constant", () => {
  expect(offenders).toEqual([]);
});
