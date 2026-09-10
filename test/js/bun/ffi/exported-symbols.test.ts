import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { compileFixture, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

// A native addon resolves bun's symbols through the dynamic linker, so it can
// reference what the export list of the platform names: src/symbols.txt on
// macOS, src/linker.lds on Linux. The napi and v8 tests load addons, which
// covers the napi, uv, v8 and node entries of those lists. The names below are
// lldb helpers (misctools/lldb), so no addon test references them.
//
// Each probe takes the address of the symbol. An address is bound when the
// library loads (RTLD_LAZY only defers calls), so a missing export fails in
// dlopen(), which names the symbol.
const hasCCompiler = !!(Bun.which("cc") || Bun.which("clang") || Bun.which("gcc"));

describe.skipIf(isWindows || !hasCCompiler)("symbols exported for the debugger", () => {
  test.each([
    // src/jsc/btjs.rs
    "dumpBtjsTrace",
    // JSC::CallFrame::describeFrame(), called by misctools/lldb/lldb_webkit.py
    "_ZN3JSC9CallFrame13describeFrameEv",
  ])("a shared library that references %s loads", symbol => {
    using dir = tempDir("exported-symbol", {
      "probe.c": `
        extern void ${symbol}(void);
        const void* probe(void) { return (const void*)&${symbol}; }
      `,
    });
    // ld64 rejects an undefined reference in a dylib unless told to resolve it
    // at load time. ELF linkers leave it for the dynamic linker by default.
    const library = compileFixture(join(String(dir), "probe.c"), {
      flags: isMacOS ? ["-undefined", "dynamic_lookup"] : [],
    });

    const lib = dlopen(library, { probe: { args: [], returns: "ptr" } });
    try {
      expect(lib.symbols.probe()).not.toBeNull();
    } finally {
      lib.close();
    }
  });
});
