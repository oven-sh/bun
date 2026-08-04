// Guards against reintroduction of symbols removed as dead code from
// src/resolver (unused Clone/Default impls), src/install (PrintFormat::Info,
// OldV2VersionedURL), src/event_loop (ManagedTask::cancel), src/runtime
// (StatOrNotFound::to_js duplicate, FetchRequestBodySinkJSSink alias).
// Each entry was verified to have zero callers across src/ and
// build/debug/codegen/ before deletion; `bun bd` and `bun run rust:check-all`
// pass with them removed.
//
// This is a source-tree lint: it reads files from src/ and does not
// touch the built binary.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("dead resolver trait impls do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/resolver/fs.rs", /impl Clone for Entry \{/],
    ["src/resolver/fs.rs", /impl Default for Entry \{/],
    ["src/resolver/result.rs", /impl Default for DirEntryResolveQueueItem \{/],
    ["src/resolver/lib.rs", /impl Default for Fs \{/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead install/event_loop/runtime symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/install/lockfile/Package/Scripts.rs", /^\s*Info,\s*$/m],
    ["src/install_types/resolver_hooks.rs", /\bOldV2VersionedURL\b/],
    ["src/install_types/lib.rs", /\bOldV2VersionedURL\b/],
    ["src/install/lib.rs", /\bOldV2VersionedURL\b/],
    ["src/event_loop/ManagedTask.rs", /pub fn cancel\(&mut self\)/],
    ["src/runtime/node/node_fs.rs", /impl StatOrNotFound \{\n    pub fn to_js\(&mut self,/],
    ["src/runtime/webcore/fetch/FetchRequestBodySink.rs", /\bFetchRequestBodySinkJSSink\b/],
    ["src/runtime/webcore/fetch.rs", /\bFetchRequestBodySinkJSSink\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
