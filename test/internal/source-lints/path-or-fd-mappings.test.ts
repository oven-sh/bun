import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Two mappings over the path-or-fd enums used to be written out twice each in
// src/runtime/webcore/Blob.rs (mordant's `same_match_twice`), and the mordant
// job is advisory, so nothing stopped a third copy. Each mapping now has one
// home, and this lint keeps every other site calling it:
//
//   - turning one PathOrFileDescriptor into another: the
//     `From<&node_types::PathOrFileDescriptor>` impl next to
//     `webcore::PathOrFileDescriptor` (node -> webcore, the FileSink input),
//     and FileSink::start (webcore -> bun_io);
//   - reading the path or fd a `PathOrBlob` destination points at:
//     `PathOrBlob::pathlike()`.
//
// A new copy shows up here as an extra file in the count; a new conversion
// target gets its single impl added to the expected sites below.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(abs => abs.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const MAPPINGS = {
  // A match arm rebuilding one enum's `Fd` as another PathOrFileDescriptor's
  // `Fd`: the first arm of an open-coded conversion. `Self::Fd(..)` on the
  // left would be the enum's own Clone impl, which is not a conversion.
  pathOrFdConversion: {
    re: /\bPathOrFileDescriptor::Fd\(\s*\w+\s*\)\s*=>\s*(?:Self|(?:[\w:]+::)?PathOrFileDescriptor)::Fd\(/g,
    sites: {
      "src/runtime/webcore.rs": 1,
      "src/runtime/webcore/FileSink.rs": 1,
    },
  },
  // A `PathOrBlob::Blob` arm reaching through the blob's file store for its
  // pathlike.
  pathOrBlobPathlike: {
    re: /\bPathOrBlob::Blob\(\s*\w+\s*\)\s*=>[^;]*?\.as_file\(\)\s*\.pathlike\b/g,
    sites: {
      "src/runtime/node/types.rs": 1,
    },
  },
} satisfies Record<string, { re: RegExp; sites: Record<string, number> }>;

/** Mapping name -> source file -> number of copies of that mapping in it. */
const found: Record<keyof typeof MAPPINGS, Record<string, number>> = {
  pathOrFdConversion: {},
  pathOrBlobPathlike: {},
};
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions don't count.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const name of Object.keys(MAPPINGS) as (keyof typeof MAPPINGS)[]) {
    const copies = stripped.match(MAPPINGS[name].re)?.length ?? 0;
    if (copies > 0) found[name][source] = copies;
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("PathOrFileDescriptor conversions exist once per target type", () => {
  expect(found.pathOrFdConversion).toEqual(MAPPINGS.pathOrFdConversion.sites);
});

test("a PathOrBlob's pathlike is only read through PathOrBlob::pathlike()", () => {
  expect(found.pathOrBlobPathlike).toEqual(MAPPINGS.pathOrBlobPathlike.sites);
});
