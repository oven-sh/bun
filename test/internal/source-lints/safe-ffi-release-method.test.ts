import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A C/C++ object that Rust only ever sees through an opaque handle (`opaque_ffi!`,
// or a hand-rolled `[u8; 0]` struct) must not expose the call that frees it, or
// gives back its refcount, as a safe method on the handle:
//
//     pub fn deinit(&mut self) {
//         URL__deinit(self)          // C++: `delete url;`
//     }
//
// The handle is a ZST, so a `&Handle` / `&mut Handle` reborrowed from any non-null
// pointer is a valid reference (`opaque_ffi!` even offers safe `opaque_ref` /
// `opaque_mut` for it) and proves neither that the caller owns the allocation nor
// that it is still alive. A `&self` / `&mut self` receiver is also not consumed by
// the call, so fully safe code can call the method twice (double free) or keep
// using the handle afterwards (use after free). `bun_url::whatwg::URL::deinit` had
// exactly this shape.
//
// Either of these shapes is fine:
//
//   * `pub unsafe fn destroy(this: *mut Self)` with a `# Safety` contract
//     (`bun_url::whatwg::URL`, `bun_jsc::URL`, `RegularExpression`, ...).
//   * A private shim reached only from `Drop` of an owning wrapper
//     (`CookieMapRef` in runtime/webcore/CookieMap.rs, `OwnedJscUrl` in
//     install/hosted_git_info.rs).
//
// Sibling guards: unsound-erased-box.test.ts, frozen-nonnull-reborrow.test.ts.

// `pub` (any visibility) method, not `unsafe` (`pub unsafe fn` does not match because
// `unsafe` sits between `pub` and `fn`), taking `&self` / `&mut self`, whose body
// starts by handing `self` (or a projection of it) to a shim whose name ends in a
// free or refcount-release verb. The shim must be a bare identifier: extern shims
// are declared in the file that wraps them and called unqualified, whereas a
// path-qualified call (`bun_opaque::opaque_deref(self.ptr)`, `Async::actually_deinit(self, id)`)
// is a Rust helper that merely takes `self` as context. Sockets' `close` shims are a
// different lifecycle (the library frees the socket later, from its event loop) and
// are deliberately not matched either.
const RELEASE_FORWARDER =
  /\bpub(?:\([^)]*\))?\s+fn\s+(\w+)\s*\(\s*(&(?:mut\s+)?self)\b[^)]*\)[^{;]*\{\s*(\w+_(?:deinit|destroy|delete|free|dealloc|deref|unref|release))\s*\(\s*self\b/g;

// Instances that predate this lint and are being removed separately (FetchHeaders
// and SourceProvider become Drop-owned handles in #33820; AbortSignal is tracked on
// its own). Ratchet: delete the entry together with the method (the test below
// fails on a stale entry). Prefer converting a new instance over adding one here.
const ALLOW = new Set([
  "src/jsc/AbortSignal.rs: unref -> WebCore__AbortSignal__unref",
  "src/jsc/FetchHeaders.rs: deref -> WebCore__FetchHeaders__deref",
  "src/jsc/SourceProvider.rs: deref -> JSC__SourceProvider__deref",
]);

// Strip `//` comments without disturbing line numbers (`[ \t]*`, not `\s*`, so the
// preceding newlines survive), so prose like the example above does not count.
function stripLineComments(content: string): string {
  return content.replace(/^[ \t]*\/\/.*$/gm, "");
}

function scan(source: string, content: string): { key: string; display: string }[] {
  const stripped = stripLineComments(content);
  const found: { key: string; display: string }[] = [];
  for (const m of stripped.matchAll(RELEASE_FORWARDER)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    found.push({
      key: `${source}: ${m[1]} -> ${m[3]}`,
      display: `${source}:${line}: pub fn ${m[1]}(${m[2]}, ..) forwards self to ${m[3]}`,
    });
  }
  return found;
}

test("matches the unsound shape and not the sound ones", () => {
  const unsound = `
    impl URL {
        pub fn deinit(&mut self) {
            URL__deinit(self)
        }
    }
    impl Headers {
        pub(crate) fn deref(&self) -> u32 { WebCore__Headers__deref(self.0) }
    }
    impl Archive {
        pub fn free(&self, mode: Mode) {
            archive_read_free(self.as_mut_ptr(), mode)
        }
    }
  `;
  expect(scan("x.rs", unsound).map(o => o.key)).toEqual([
    "x.rs: deinit -> URL__deinit",
    "x.rs: deref -> WebCore__Headers__deref",
    "x.rs: free -> archive_read_free",
  ]);

  const sound = `
    impl URL {
        /// pub fn deinit(&mut self) { URL__deinit(self) }
        pub unsafe fn destroy(this: *mut Self) {
            unsafe { URL__deinit(this) }
        }
        pub fn protocol(&self) -> String {
            URL__protocol(self)
        }
        pub fn release_weak_refs(&self) {
            JSC__VM__releaseWeakRefs(self)
        }
        pub fn into_raw(self) {
            Foo__deinit(self)
        }
        pub fn global(&self) -> &JSGlobalObject {
            bun_opaque::opaque_deref(self.global)
        }
        pub(crate) fn async_cmd_done(&self, id: NodeId) {
            Async::actually_deinit(self, id);
        }
    }
    impl Drop for CookieMapRef {
        fn drop(&mut self) {
            CookieMap__deref(self)
        }
    }
    trait Release {
        fn release(&self);
    }
    impl Owned {
        pub fn unref(&self) {
            self.0.take().map(|p| unsafe { Foo__unref(p) });
        }
    }
  `;
  expect(scan("x.rs", sound)).toEqual([]);
});

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

const offenders: { key: string; display: string }[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  offenders.push(...scan(source, await file(abs).text()));
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the bans below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("no safe &self method frees or releases an FFI handle", () => {
  expect(offenders.filter(o => !ALLOW.has(o.key)).map(o => o.display)).toEqual([]);
});

test("every ALLOW entry is still present (delete the entry along with the method)", () => {
  const seen = new Set(offenders.map(o => o.key));
  expect([...ALLOW].filter(key => !seen.has(key))).toEqual([]);
});
