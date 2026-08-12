import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A kevent changelist entry the kernel rejects is handed back in the eventlist
// with EV_ERROR set in `flags` and the errno in `data`. How it is "set" differs
// between the two kqueue kernels we build for:
//
//   xnu      (bsd/kern/kern_event.c, kevent_register)   kev->flags |= EV_ERROR;
//   FreeBSD  (sys/kern/kern_event.c, kqueue_kevent)      kevp->flags = EV_ERROR;
//
// so on macOS the reply to a rejected `EV_ADD|EV_ONESHOT` reads 0x4011, not
// 0x4000, and `flags == EV_ERROR` is false for it: the io request loop
// (src/io/lib.rs) dispatched such a reply as a ready event, and FilePoll
// (src/io/posix_event_loop.rs) used to swallow its change errors the same way
// (#31701). Both kernels agree on the bit, so that is what gets tested:
//
//   flags == EV_ERROR / flags != EV::ERROR   ->   (flags & EV_ERROR) != 0
//
// Both of the io layer's kqueue users inherited the equality from the Zig
// original; this keeps it from coming back in either. Scope is the Rust tree
// because that is what .github/workflows/source-lints.yml runs this for; the C
// kqueue code in packages/bun-usockets is outside its triggers.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(abs => abs.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// The constant in any of its spellings: `EV_ERROR`, `libc::EV_ERROR`,
// `bun_sys::darwin::EV::ERROR`, ...
const CONSTANT = String.raw`(?:\w+::)*EV(?:_ERROR|::ERROR)\b`;
// `x & EV_ERROR`: the bit test. `(?<!&)&(?!&)` keeps `&&` out of it.
const BIT_TEST = new RegExp(String.raw`(?<!&)&(?!&)\s*${CONSTANT}`);
// The constant as either operand of `==` / `!=`, optionally parenthesized.
const COMPARED = new RegExp(String.raw`(?:==|!=)\s*\(?\s*${CONSTANT}|\b${CONSTANT}\s*\)?\s*(?:==|!=)`);

// Comments are cut per line at `//`, and only per line: stripping `/* */`
// spans would let a `/*` inside a line comment or a glob string literal
// swallow everything up to some distant `*/`, silently blinding the lint to
// whatever is in between. Rust has no `/* */` comments in the kqueue code and
// a prose mention in one would fail loudly here, which is the better failure.
function classify(line: string): "bit-test" | "compared" | null {
  const code = line.replace(/\/\/.*$/, "");
  // A line that masks with the constant is not comparing the whole word
  // against it, whatever else it does: `(flags & EV_ERROR) == EV_ERROR` is a
  // (verbose) bit test, and so is Rust's `flags & EV_ERROR == 0`, since `&`
  // binds tighter than `==` there.
  if (BIT_TEST.test(code)) return "bit-test";
  if (COMPARED.test(code)) return "compared";
  return null;
}

const offenders: string[] = [];
const filesWithBitTests = new Set<string>();
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  if (!content.includes("EV_ERROR") && !content.includes("EV::ERROR")) continue;
  for (const [index, line] of content.split("\n").entries()) {
    switch (classify(line)) {
      case "bit-test":
        filesWithBitTests.add(source);
        break;
      case "compared":
        offenders.push(`${source}:${index + 1}: ${line.trim()}`);
        break;
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the scan still sees the bit tests that are known to be in the tree", () => {
  // Named files rather than a count: if the file set or the comment handling
  // ever stops seeing one of these, the ban below would be vacuous for it.
  // FilePoll's register/unregister and the process reaper's kevent loop.
  expect([...filesWithBitTests].sort()).toEqual(
    expect.arrayContaining(["src/io/posix_event_loop.rs", "src/spawn/process.rs"]),
  );
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    "if event.flags == libc::EV_ERROR {",
    "if changelist[0].flags == EV::ERROR {",
    "if ev.flags != bun_sys::darwin::EV::ERROR {",
    "if libc::EV_ERROR == event.flags {",
    "let failed = event.flags == (EV::ERROR);",
    "if event.flags == EV_ERROR && event.data != 0 {",
  ];
  const allowed = [
    "if (event.flags & libc::EV_ERROR) != 0 {",
    "if (changelist[0].flags & EV::ERROR) != 0 && changelist[0].data != 0 {",
    "if (changelist[i].flags & EV::ERROR) == 0 || changelist[i].data == 0 {",
    "if (event.flags & EV_ERROR) == EV_ERROR {",
    "if r.flags & libc::EV_ERROR == 0 || r.data == 0 {",
    "if event.data != 0 && event.flags & EV_ERROR != 0 {",
    "let is_error = event.flags & EV::ERROR != 0;",
    "pub const ERROR: u16 = libc::EV_ERROR;",
    "    // xnu ORs EV_ERROR in, so `flags == EV_ERROR` is the bug this comment is about",
    "let rejected = (kev.flags & EV::ERROR) != 0; // not kev.flags == EV::ERROR",
  ];
  expect(banned.filter(s => classify(s) !== "compared")).toEqual([]);
  expect(allowed.filter(s => classify(s) === "compared")).toEqual([]);
});

test("kevent EV_ERROR is tested as a bit, never compared against the whole flags word", () => {
  expect(offenders).toEqual([]);
});
