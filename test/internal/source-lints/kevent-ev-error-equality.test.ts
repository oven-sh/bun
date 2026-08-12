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
// so on macOS the reply to a failed `EV_ADD|EV_ONESHOT` reads 0x4011, not
// 0x4000, and `flags == EV_ERROR` silently classifies it as a ready event.
// For the io request loop that meant a rejected registration was dispatched
// as "readable", which re-reads, gets EAGAIN, re-registers, and spins; for
// FilePoll (posix_event_loop.rs) it meant change errors were swallowed. Both
// kernels agree on the bit, so that is what gets tested:
//
//   flags == EV_ERROR / flags != EV::ERROR   →   (flags & EV_ERROR) != 0
//
// The Zig original carried the equality in both kqueue users; the port fixed
// FilePoll's and this lint keeps the other from coming back.

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
// `x & EV_ERROR` is the bit test this lint asks for. It is erased before
// looking for comparisons so that `(flags & EV_ERROR) == 0`, and Rust's
// `flags & EV_ERROR == 0` (`&` binds tighter than `==` in Rust), do not
// register as comparing the whole word. `(?<!&)&(?!&)` keeps `&&` out of it.
const BIT_TEST = new RegExp(String.raw`(?<!&)&(?!&)\s*${CONSTANT}`, "g");
// The constant as either operand of `==` / `!=`, optionally parenthesized.
const COMPARED = new RegExp(String.raw`(?:==|!=)\s*\(?\s*${CONSTANT}|\b${CONSTANT}\s*\)?\s*(?:==|!=)`);

function comparesWholeWord(line: string): boolean {
  return COMPARED.test(line.replace(BIT_TEST, ""));
}

const offenders: string[] = [];
let scanned = 0;
let bitTests = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  if (!content.includes("EV_ERROR") && !content.includes("EV::ERROR")) continue;
  // Drop comments (the ones in posix_event_loop.rs and io/lib.rs describe this
  // very hazard) without disturbing line numbers: block comments keep their
  // newlines, line comments are cut at the `//`.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, "")).replace(/\/\/.*$/gm, "");
  for (const [index, line] of stripped.split("\n").entries()) {
    BIT_TEST.lastIndex = 0;
    if (BIT_TEST.test(line)) bitTests++;
    if (comparesWholeWord(line)) offenders.push(`${source}:${index + 1}: ${line.trim()}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the scan still sees the tree's EV_ERROR bit tests", () => {
  // FilePoll's register/unregister (src/io/posix_event_loop.rs) and the
  // process reaper (src/spawn/process.rs) test the bit; if none are seen, the
  // file set or the comment stripping is broken and the ban below is vacuous.
  expect(bitTests).toBeGreaterThan(0);
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
    "if r.flags & libc::EV_ERROR == 0 || r.data == 0 {",
    "if event.data != 0 && event.flags & EV_ERROR != 0 {",
    "pub const ERROR: u16 = libc::EV_ERROR;",
    "let is_error = event.flags & EV::ERROR != 0;",
  ];
  expect(banned.filter(s => !comparesWholeWord(s))).toEqual([]);
  expect(allowed.filter(comparesWholeWord)).toEqual([]);
});

test("kevent EV_ERROR is tested as a bit, never compared against the whole flags word", () => {
  expect(offenders).toEqual([]);
});
