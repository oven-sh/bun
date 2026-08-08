// Guards against reintroduction of symbols removed as dead code from the
// bindgen codegen scripts, bun_core, bun_url, the dns/napi JSC glue, and the
// internal sql builtin. The same change also deletes five orphaned developer
// scripts and the src/jsc/bindings/v8/v8config.h include shim outright; whole
// files are not pinned here because restoring one is a deliberate act, not
// accidental rot.
// Each entry was verified to have zero references across src/, scripts/,
// test/, packages/, and freshly regenerated build/debug/codegen/ output
// before deletion. src/codegen/bindgen.ts produces byte-identical output
// before and after the removal, and the removal was validated by a full
// `bun bd` build plus `bun run rust:check-all`.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
// All checks read the working tree, so the lint fails while the dead symbols
// are present and passes once they are gone, regardless of where HEAD points.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("dead zig-emission machinery in bindgen does not reappear", () => {
  // Commit d4514457e8 stopped writing GeneratedBindings.zig but left the
  // code populating the zig/zigInternal buffers. Everything feeding those
  // buffers is gone: the writers, emitZigStruct, zigTypeName,
  // returnStrategyZigType, the zig decoder emitters, the whole zig dispatch
  // loop, and the zig-only metadata (zigPrefix/implNamespace/zigMappedName,
  // the never-read allFunctions list, the zigEnum type kind with zero users).
  const checks: Array<[string, RegExp]> = [
    ["src/codegen/bindgen.ts", /\bzigInternal\b|\bemitZigStruct\b|\bzigTypeName\b|\breturnStrategyZigType\b/],
    ["src/codegen/bindgen.ts", /\bemitNullableZigDecoder\b|\bemitComplexZigDecoder\b|\bzigEnum\b/],
    ["src/codegen/bindgen-lib-internal.ts", /\bemitZig\b|\bzigPrefix\b|\bzigMappedName\b|\bzigEnum\b/],
    ["src/codegen/bindgen-lib-internal.ts", /\ballFunctions\b|\bexport const snake\b/],
    ["src/codegen/bindgen-lib.ts", /\bzigEnum\b|\bexposedOn\b|\bExposedOn\b|\bimplNamespace\b/],
    ["src/jsc/fmt_jsc.bind.ts", /\bimplNamespace\b/],
    // class option read by nothing in generate-classes.ts or any .classes.ts.
    ["src/codegen/class-definitions.ts", /\bisEventEmitter\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols (bun_core, bun_url, dns/napi glue) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // QuoteEscapeFormatFlags.ascii_only: write-only; the Display impl
    // hardcodes false.
    ["src/bun_core/string/immutable.rs", /\bpub ascii_only:/],
    // QueryStringMap name_count remnant: write-only field, unused
    // thread-local, and the commented-out Zig port body that referenced it.
    ["src/url/lib.rs", /\bNAME_COUNT_BUF\b|\bname_count:/],
    // dns_jsc: second name for internal::Request with zero users (the
    // underlying type stays reachable via the `internal` re-export).
    ["src/runtime/dns_jsc/dns.rs", /\bInternalDNSRequest\b/],
    ["src/runtime/dns_jsc/mod.rs", /\bInternalDNSRequest\b/],
    // The commented Rust stub for napi_get_property_names duplicated the
    // live C++ implementation.
    ["src/runtime/napi/napi_body.rs", /napi_get_property_names/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead built-in JS exports do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Export entries no requirer destructures, including the vendored Node
    // tests that import internal modules under --expose-internals (the
    // backing Symbols stay, used as private class keys).
    ["src/js/internal/sql/query.ts", /^\s*(_resolve|_reject|_queryStatus|_handler|_flags),$/m],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
