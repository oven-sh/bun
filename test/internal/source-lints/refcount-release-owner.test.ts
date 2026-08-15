import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Intrusively refcounted foreign objects (`WTF::RefCounted` on the C++ side,
// `napi_env`, ...) are owned from Rust through an RAII handle: `Clone` takes a
// ref, `Drop` releases one, and adopting a raw `+1` into the handle is an
// `unsafe fn` that states the ownership transfer. The FFI shim that releases a
// ref frees the object when the count hits zero, so it may only be called from
// that handle's release hook. Wrapping it in a safe method on the pointee
// (`AbortSignal::unref(&self)`, `AbortSignal::detach(&self, ..)`) let safe code
// release a ref it did not own: the pointee is an `opaque_ffi!` ZST, so
// `&AbortSignal` is obtainable from any pointer (and from `AbortSignalRef`'s
// `Deref`), and `AbortSignal::ref_from_js(v)?.unref()` followed by the
// `AbortSignalRef`'s own `Drop` was a double release without any `unsafe`.
//
// Each entry below is a release shim, the file that declares it, and the one
// function allowed to call it. Every other mention in `src/**/*.rs` is an
// escape hatch that needs to become an owned handle (or an `unsafe` adopt of
// the raw ref into one). Counts are asserted exactly so a renamed shim shows
// up here instead of silently dropping out of the lint.
const RELEASE_SHIMS: Record<string, { file: string; owner: string }> = {
  // `WebCore::AbortSignal`; the owner is `AbortSignalRef` (`ExternalShared<AbortSignal>`).
  WebCore__AbortSignal__unref: { file: "src/jsc/AbortSignal.rs", owner: "ext_deref" },
  // `JSC::ArrayBuffer`; the owner is `ExternalShared<JSCArrayBuffer>`.
  JSC__ArrayBuffer__deref: { file: "src/jsc/array_buffer.rs", owner: "ext_deref" },
  // `napi_env`; the owner is `NapiEnvRef` (`ExternalShared<NapiEnv>`).
  NapiEnv__deref: { file: "src/runtime/napi/napi_body.rs", owner: "ext_deref" },
  // `WebCore::CookieMap`; the owner is the hand-rolled `CookieMapRef`.
  CookieMap__deref: { file: "src/runtime/webcore/CookieMap.rs", owner: "drop" },
};

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

interface Usage {
  declarations: number;
  ownerCalls: number;
  other: string[];
}

const usage = new Map<string, Usage>();
for (const shim of Object.keys(RELEASE_SHIMS)) {
  usage.set(shim, { declarations: 0, ownerCalls: 0, other: [] });
}

const FN_HEADER = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(<]/;

let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Every shim name is a `__`-joined identifier that never appears in normal
  // prose, so a whole-file substring check skips almost everything.
  if (!Object.keys(RELEASE_SHIMS).some(shim => content.includes(shim))) continue;

  // Strip `//` comments (full-line and trailing) so prose mentions don't count.
  const lines = content.split("\n").map(line => line.replace(/\/\/.*$/, ""));
  for (const [shim, { file: declFile, owner }] of Object.entries(RELEASE_SHIMS)) {
    const ident = new RegExp(`\\b${shim}\\b`);
    const record = usage.get(shim)!;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!ident.test(line)) continue;
      const declared = new RegExp(`\\bfn\\s+${shim}\\s*\\(`).test(line);
      // The enclosing function is the nearest `fn` header above the call.
      let enclosing: string | undefined;
      for (let j = i - 1; j >= 0 && enclosing === undefined; j--) {
        enclosing = FN_HEADER.exec(lines[j])?.[1];
      }
      if (source === declFile && declared) {
        record.declarations++;
      } else if (source === declFile && enclosing === owner) {
        record.ownerCalls++;
      } else {
        record.other.push(`${source}:${i + 1} (in fn ${enclosing ?? "<none>"}): ${line.trim()}`);
      }
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing (e.g. a
  // symlinked checkout root) and leaving nothing to scan, so a failure below
  // is attributable to the sources rather than to the scan. Same guard as
  // unsound-erased-box.test.ts.
  expect(scanned).toBeGreaterThan(0);
});

for (const [shim, { owner }] of Object.entries(RELEASE_SHIMS)) {
  test(`${shim} is declared once and called only from ${owner}`, () => {
    expect(usage.get(shim)).toEqual({ declarations: 1, ownerCalls: 1, other: [] });
  });
}
