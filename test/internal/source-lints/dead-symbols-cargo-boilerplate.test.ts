// A copy-pasted `[dependencies]` boilerplate block (strum, bstr, scopeguard,
// const_format, enum-map, enumset, libc, bitflags) was stamped into ~70 crate
// manifests by the Zig→Rust port scaffolding, regardless of whether the crate
// used any of them. Each unused entry is a dependency edge cargo must resolve
// and a crate it must check on every incremental build.
//
// This test pins a handful of the most egregious cases (tiny leaf crates that
// listed 7-8 deps and used none of them) so the boilerplate doesn't creep
// back in when someone copies a Cargo.toml to scaffold a new crate.
//
// It also pins a few dead C++/Rust symbols removed alongside, so they stay
// gone.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, describe } from "bun:test";

const repoRoot = join(import.meta.dir, "../../..");

describe("unused boilerplate Cargo deps stay removed", () => {
  // Crates that provably used none of the listed deps on any target (verified
  // by `bun run rust:check-all` after removal).
  const crates: Record<string, string[]> = {
    "src/wyhash/Cargo.toml": ["strum", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags"],
    "src/ptr/Cargo.toml": ["strum", "const_format", "enum-map", "enumset", "libc", "bitflags", "thiserror"],
    "src/base64/Cargo.toml": ["bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags"],
    "src/brotli_sys/Cargo.toml": ["strum", "bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags", "thiserror"],
    "src/mimalloc_sys/Cargo.toml": ["strum", "bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags"],
    "src/simdutf_sys/Cargo.toml": ["strum", "bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags"],
    "src/sha_hmac/Cargo.toml": ["strum", "bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags"],
    "src/safety/Cargo.toml": ["strum", "bstr", "scopeguard", "const_format", "enum-map", "enumset", "libc", "bitflags", "thiserror"],
  };

  for (const [rel, deps] of Object.entries(crates)) {
    test(rel, () => {
      const toml = readFileSync(join(repoRoot, rel), "utf8");
      const present = deps.filter(d => new RegExp(`^${d}(\\.workspace\\s*=|\\s*=)`, "m").test(toml));
      expect(present).toEqual([]);
    });
  }
});

describe("dead symbols stay removed", () => {
  const cases: Array<[string, string]> = [
    ["src/jsc/bindings/helpers.h", "toStringNotConst"],
    ["src/jsc/bindings/helpers.h", "BunStringCwd"],
    ["src/jsc/bindings/helpers.h", "static WTF::AtomString toAtomString(ZigString"],
    ["src/runtime/bake/BakeSourceProvider.cpp", "BakeRegisterProductionChunk"],
    ["src/runtime/api/bun/subprocess/Readable.rs", "pub fn on_ready"],
    ["src/io/posix_event_loop.rs", "pub use crate::closer::Closer"],
  ];

  for (const [rel, needle] of cases) {
    test(`${rel} has no ${JSON.stringify(needle)}`, () => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      expect(src.includes(needle)).toBe(false);
    });
  }

  test("BakeProduction.h is deleted", () => {
    expect(existsSync(join(repoRoot, "src/runtime/bake/BakeProduction.h"))).toBe(false);
  });
});
