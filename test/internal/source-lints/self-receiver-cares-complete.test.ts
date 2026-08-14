import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `on_cares_complete(this: *mut Self, ..)` (src/runtime/dns_jsc/dns.rs, one per
// c-ares request type) reclaims the request's allocation on every path, so a
// `&self` / `&mut self` method must not hand it its own receiver:
// `Self::on_cares_complete(ptr::from_mut(self), ..)` frees the allocation
// while the receiver argument is still live, which is UB under the aliasing
// models whether or not `self` is used again (Miri: "the strongly protected
// tag disallows deallocations"). The c-ares handler traits hand the request
// over as `this: *mut Self` for exactly this reason (the `#[cfg(test)]` module
// at the end of src/cares_sys/c_ares.rs drives that under Miri), so the impls
// forward `this`; this lint keeps any other spelling out.
//
// This is the `on_cares_complete` case of the hazard self-receiver-reclaim
// .test.ts bans for the reclaim primitives themselves (same receiver spellings,
// plus bare `self`, which coerces to `*mut Self` at a raw-pointer parameter);
// a lint keyed on consuming-helper names generally is where this entry
// belongs once one exists.
//
// Sibling guards: self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

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

// The receiver as the first argument: bare `self`, or any spelling of its
// address. `(?!\s*\.)` keeps a field's address (`&raw mut *self.head`) out.
const SELF_AS_POINTER = [
  String.raw`self\s*[,)]`,
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&\s*(?:raw\s+(?:mut|const)|mut)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

// `\s*` after the paren so a rustfmt-wrapped argument list still matches.
const BANNED = new RegExp(String.raw`\bon_cares_complete\s*\(\s*(?:${SELF_AS_POINTER})`, "g");

function offendersIn(source: string, content: string): string[] {
  // Strip full-line comments so prose mentions don't count. `[ \t]*`, not
  // `\s*`: `\s` crosses newlines and would shift the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  return [...stripped.matchAll(BANNED)].map(
    m => `${source}:${stripped.slice(0, m.index).split("\n").length}: ${m[0].replace(/\s+/g, " ")}`,
  );
}

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  offenders.push(...offendersIn(source, await file(abs).text()));
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the filters above over-firing and leaving nothing to scan,
  // which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    // The dns.rs impls as they were, one-line and rustfmt-wrapped.
    "Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status, timeouts, result);",
    "Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);",
    "GetNameInfoRequest::on_cares_complete(\n    std::ptr::from_mut::<Self>(self),\n    status,\n    timeouts,\n    info,\n);",
    // Other spellings of the receiver.
    "Self::on_cares_complete(self, status, timeouts, result);",
    "Self::on_cares_complete(self as *mut Self, status, timeouts, result);",
    "Self::on_cares_complete(&raw mut *self, status, timeouts, result);",
    "Self::on_cares_complete(core::ptr::addr_of_mut!(*self), status, timeouts, result);",
    "Self::on_cares_complete(NonNull::from(self), status, timeouts, result);",
  ];
  const allowed = [
    // The pointer comes in as a parameter.
    "Self::on_cares_complete(this, status, timeouts, result);",
    "GetNameInfoRequest::on_cares_complete(\n    this,\n    status,\n    timeouts,\n    info,\n);",
    // A request the receiver owns, and the definition itself.
    "Request::on_cares_complete(self.request, status, timeouts, result);",
    "Request::on_cares_complete(&raw mut *self.request, status, timeouts, result);",
    "fn on_cares_complete(\n    this: *mut Self,\n    err_: Option<c_ares::Error>,\n) {",
    // Prose.
    "// forwards to `on_cares_complete(self)` in spirit",
  ];
  expect(banned.filter(s => offendersIn("x.rs", s).length === 0)).toEqual([]);
  expect(allowed.flatMap(s => offendersIn("x.rs", s))).toEqual([]);
});

test("no method hands its own receiver to on_cares_complete", () => {
  expect(offenders).toEqual([]);
});
