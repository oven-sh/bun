/**
 * `DirectBuild.forbidUndefined` (scripts/build/source.ts) is how the build
 * proves that the deps bun points at mimalloc (BoringSSL through its
 * OPENSSL_memory_* / OPENSSL_system_* hooks, libuv through
 * uv_replace_allocator) no longer reach the C library's allocator directly:
 * a stray malloc() in one of them lands on the C runtime heap on Windows and
 * macOS without anything observable failing, and freeing it through the
 * library's hook crashes (oven-sh/libuv#14). Only the objects show it, so
 * `llvm-nm -u` over them is a build edge whose stamp the link depends on.
 *
 * Checked here: the nm output parser (one list of names has to match ELF,
 * COFF and Mach-O spellings), the edge the emitter produces from a dep spec,
 * and the two deps' declarations.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { resolve } from "node:path";

import { registerCompileRules, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { boringssl } from "../../scripts/build/deps/boringssl.ts";
import { libuv } from "../../scripts/build/deps/libuv.ts";
import { forbiddenUndefined } from "../../scripts/build/fetch-cli.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { LIBC_ALLOCATION_SYMBOLS, registerDepRules, resolveDep, type Dependency } from "../../scripts/build/source.ts";

function mockToolchain(nm: string | undefined): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ranlib: "/fake/llvm/bin/llvm-ranlib",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: undefined,
    rustLld: undefined,
    rustLlvmVersion: undefined,
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm,
    dsymutil: undefined,
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
  };
}

/** A linux-x64 target with the hooks on unless `asan`, and llvm-nm found unless `withoutNm`; nothing is built. */
function configure(buildDir: string, { asan = false, withoutNm = false, archiveDeps = false } = {}): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", asan, archiveDeps, buildDir, linuxSysroot: buildDir },
    mockToolchain(withoutNm ? undefined : "/fake/llvm/bin/llvm-nm"),
  );
}

/** The fake dep's three sources live under the build dir so their objects land under obj/. */
function fakeDep(srcDir: string, except?: string[]): Dependency {
  return {
    name: "fakedep",
    source: () => ({ kind: "local", path: srcDir }),
    build: () => ({
      kind: "direct",
      sources: ["a.c", "table.c", "sub/b.c"],
      forbidUndefined: { symbols: ["malloc", "free"], except },
    }),
    provides: () => ({ libs: [], includes: ["."] }),
  };
}

function emit(cfg: Config, dep: Dependency) {
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerDirStamps(n, cfg);
  registerCompileRules(n, cfg);
  registerDepRules(n, cfg);
  const resolved = resolveDep(n, cfg, dep, new Map())!;
  const ninja = n.toString().replace(/ \$\n +/g, " ");
  const edge = ninja.split("\n").find(line => line.includes(": dep_check_undefined "));
  return { resolved, ninja, edge };
}

describe("forbiddenUndefined", () => {
  const symbols = LIBC_ALLOCATION_SYMBOLS;

  test("matches the ELF, COFF and Mach-O spellings and nothing else", () => {
    const output = [
      "obj/a.o:                  U malloc", // ELF / COFF x64
      "obj/a.o:                  U OPENSSL_system_malloc", // the hook itself is fine
      "obj/b.o:                  U _free", // Mach-O
      "obj/b.o:                  U __wcsdup", // Mach-O spelling of _wcsdup
      "obj/c.obj:                U _wcsdup", // COFF
      "obj/c.obj:                U __imp_GetLastError",
      "obj/d.o: 0000000000000000 U realloc", // a format that prints a value column
      "obj/d.o: 0000000000000010 T OPENSSL_malloc", // defined symbols never count
      "obj/e.o:                  U mallocx",
      "",
    ].join("\n");
    expect(forbiddenUndefined(output, symbols)).toEqual([
      { object: "obj/a.o", symbol: "malloc" },
      { object: "obj/b.o", symbol: "_free" },
      { object: "obj/b.o", symbol: "__wcsdup" },
      { object: "obj/c.obj", symbol: "_wcsdup" },
      { object: "obj/d.o", symbol: "realloc" },
    ]);
  });

  test("keeps a Windows drive letter in the object name", () => {
    const output = "C:\\b\\obj\\uv.obj:                 U calloc\n";
    expect(forbiddenUndefined(output, symbols)).toEqual([{ object: "C:\\b\\obj\\uv.obj", symbol: "calloc" }]);
  });

  test("clean output yields nothing", () => {
    expect(forbiddenUndefined("obj/a.o:                  U memcpy\n", symbols)).toEqual([]);
    expect(forbiddenUndefined("", symbols)).toEqual([]);
  });
});

describe("the dep_check_undefined edge", () => {
  test("checks every object but the excepted source's and gates the dep on the stamp", () => {
    using dir = tempDir("forbid-undefined", { "build/dep/a.c": "", "build/dep/table.c": "", "build/dep/sub/b.c": "" });
    const buildDir = resolve(String(dir), "build");
    const cfg = configure(buildDir);
    const { resolved, ninja, edge } = emit(cfg, fakeDep(resolve(buildDir, "dep"), ["table.c"]));

    const stamp = resolve(buildDir, "deps", "fakedep", ".undefined-symbols-checked");
    expect(resolved.checks).toEqual([stamp]);
    expect(edge).toBeDefined();
    const [outputs, rest] = edge!.split(": dep_check_undefined ");
    expect(outputs).toBe("build deps/fakedep/.undefined-symbols-checked");
    const inputs = rest!.split(" | ")[0]!.split(" ");
    expect(inputs).toEqual(["obj/dep/a.c.o", "obj/dep/sub/b.c.o"]);
    expect(ninja).toContain("\n  symbols = malloc,free\n");
    expect(ninja).toContain("\n  nm = /fake/llvm/bin/llvm-nm\n");
    // `ninja fakedep` runs the check too.
    expect(ninja).toMatch(/^build fakedep: phony .*deps\/fakedep\/\.undefined-symbols-checked/m);
  });

  test("with --archiveDeps the dep's archive waits for the stamp", () => {
    using dir = tempDir("forbid-undefined-archive", {
      "build/dep/a.c": "",
      "build/dep/table.c": "",
      "build/dep/sub/b.c": "",
    });
    const buildDir = resolve(String(dir), "build");
    const { resolved, ninja } = emit(configure(buildDir, { archiveDeps: true }), fakeDep(resolve(buildDir, "dep")));
    expect(resolved.libs).toEqual([resolve(buildDir, "deps", "fakedep", "libfakedep.a")]);
    expect(ninja).toMatch(/^build deps\/fakedep\/libfakedep\.a: ar .* \| deps\/fakedep\/\.undefined-symbols-checked$/m);
  });

  test("is skipped without llvm-nm", () => {
    using dir = tempDir("forbid-undefined-no-nm", {
      "build/dep/a.c": "",
      "build/dep/table.c": "",
      "build/dep/sub/b.c": "",
    });
    const buildDir = resolve(String(dir), "build");
    const { resolved, edge } = emit(configure(buildDir, { withoutNm: true }), fakeDep(resolve(buildDir, "dep")));
    expect(resolved.checks).toEqual([]);
    expect(edge).toBeUndefined();
  });

  test("rejects an exception that names no source", () => {
    using dir = tempDir("forbid-undefined-bad-except", { "build/dep/a.c": "" });
    const buildDir = resolve(String(dir), "build");
    expect(() => emit(configure(buildDir), fakeDep(resolve(buildDir, "dep"), ["src/uv-common.c"]))).toThrow(
      /forbidUndefined\.except lists src\/uv-common\.c/,
    );
  });
});

describe("the deps that are routed to mimalloc declare it", () => {
  test("BoringSSL forbids libc allocation exactly when its hooks are compiled in", () => {
    using dir = tempDir("forbid-undefined-boringssl", {});
    const hooked = boringssl.build(configure(String(dir)));
    const asan = boringssl.build(configure(String(dir), { asan: true }));
    expect(hooked.kind === "direct" && hooked.forbidUndefined).toEqual({ symbols: LIBC_ALLOCATION_SYMBOLS });
    expect(asan.kind === "direct" && asan.forbidUndefined).toBeUndefined();
  });

  test("libuv forbids libc allocation everywhere except its default allocator table", () => {
    using dir = tempDir("forbid-undefined-libuv", {});
    const spec = libuv.build(configure(String(dir)));
    expect(spec.kind === "direct" && spec.forbidUndefined).toEqual({
      symbols: LIBC_ALLOCATION_SYMBOLS,
      except: ["src/uv-common.c"],
    });
    expect(spec.kind === "direct" && spec.sources).toContain("src/uv-common.c");
  });
});
