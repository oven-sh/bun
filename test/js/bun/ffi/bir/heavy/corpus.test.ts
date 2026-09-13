import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { includePath, meets, run, supported, wrapperSource } from "../run-fixtures";

// The C libraries vendored for Bun (and a few from other checkouts), every file of each compiled by itself with
// `bun build`: the product compiles C when it bundles, without running it. What this knows about each library is
// one row of LIBRARIES: where it lives, the include directories and macros its real build uses (see
// scripts/build/deps/<lib>.ts), which files to compile, and which to leave out, each with the reason.
//
// It reads thousands of files that may not be on disk, so it only runs when asked to
// (BUN_C_COMPILER_HEAVY_TESTS=1), and a library that is not there is skipped. The vendored sources are looked for
// in $BUN_C_CORPUS_VENDOR, or else in <repo>/vendor (the checkout the generated headers were configured for) and
// then ~/code/bun/vendor; the generated configuration headers in $BUN_C_CORPUS_BUILD (default
// <repo>/build/release-local/deps). The libraries from other checkouts are found through $BUN_C_CORPUS_NODE
// (default ~/code/node/deps), $BUN_C_CORPUS_WEBKIT (~/code/WebKit) and $BUN_C_CORPUS_LLVM (~/code/llvm-project-bun).
// (The table is each library's x86-64 Linux build: its file list, macros and generated configuration.)
const heavy = supported && meets("glibc") && meets("x64") && process.env.BUN_C_COMPILER_HEAVY_TESTS === "1";
const repo = process.env.BUN_C_CORPUS_REPO ?? join(import.meta.dir, "../../../../../..");
const places = {
  vendor: process.env.BUN_C_CORPUS_VENDOR
    ? [process.env.BUN_C_CORPUS_VENDOR]
    : [join(repo, "vendor"), join(homedir(), "code/bun/vendor")],
  $REPO: repo,
  $BUILD: process.env.BUN_C_CORPUS_BUILD ?? join(repo, "build/release-local/deps"),
  $NODE: process.env.BUN_C_CORPUS_NODE ?? join(homedir(), "code/node/deps"),
  $WEBKIT: process.env.BUN_C_CORPUS_WEBKIT ?? join(homedir(), "code/WebKit"),
  $LLVM: process.env.BUN_C_CORPUS_LLVM ?? join(homedir(), "code/llvm-project-bun"),
};

/** A path of the table: it starts with $VENDOR (a library comes from the first vendor directory that has it), $REPO, $BUILD, $NODE, $WEBKIT or $LLVM. */
function expand(path: string) {
  if (path.startsWith("$VENDOR/")) {
    const rest = path.slice("$VENDOR/".length);
    const library = rest.split("/")[0];
    const home = places.vendor.find(dir => existsSync(join(dir, library))) ?? places.vendor.at(-1)!;
    return `${home}/${rest}`;
  }
  for (const variable of ["$REPO", "$BUILD", "$NODE", "$WEBKIT", "$LLVM"] as const) {
    if (path.startsWith(variable)) return places[variable] + path.slice(variable.length);
  }
  return path;
}

interface Library {
  name: string;
  /** Everything else is relative to it. */
  root: string;
  /** Relative to the root, or starting with one of the variables `expand` knows. */
  includeDirs: string[];
  /** `NAME` or `NAME=value`. `__GNUC__=4` says the library is written for GNU C alone: it is compiled claiming 4.2.1. */
  defines: string[];
  /** `dir/*.c` (that directory), `dir/**.c` (recursively), a file, or `@list`: every quoted `something.c` in that file (a gyp source list). */
  sources: string[];
  /** A relative path, a directory prefix ending in `/`, or `*suffix`; and why. */
  skip: [string, string][];
}

const LIBRARIES: Library[] = [
  {
    name: "picohttpparser",
    root: "$VENDOR/picohttpparser",
    includeDirs: ["."],
    defines: [],
    sources: ["*.c"],
    skip: [["test.c", "needs picotest, a git submodule that is not vendored"]],
  },
  {
    name: "sqlite",
    root: "$REPO/src/jsc/bindings/sqlite",
    includeDirs: ["."],
    defines: [
      "SQLITE_ENABLE_COLUMN_METADATA=1",
      "SQLITE_MAX_VARIABLE_NUMBER=250000",
      "SQLITE_ENABLE_RTREE=1",
      "SQLITE_ENABLE_FTS3=1",
      "SQLITE_ENABLE_FTS3_PARENTHESIS=1",
      "SQLITE_ENABLE_FTS5=1",
      "SQLITE_ENABLE_JSON1=1",
      "SQLITE_ENABLE_MATH_FUNCTIONS=1",
      "SQLITE_ENABLE_UPDATE_DELETE_LIMIT=1",
      "SQLITE_UDL_CAPABLE_PARSER=1",
      "SQLITE_ENABLE_SESSION=1",
      "SQLITE_ENABLE_PREUPDATE_HOOK=1",
      "SQLITE_ENABLE_DBSTAT_VTAB=1",
      "SQLITE_ENABLE_GEOPOLY=1",
      "SQLITE_ENABLE_RBU=1",
      "SQLITE_ENABLE_PERCENTILE=1",
    ],
    sources: ["sqlite3.c"],
    skip: [],
  },
  {
    name: "zlib",
    root: "$VENDOR/zlib",
    includeDirs: [".", "arch/generic", "arch/x86", "$BUILD/zlib"],
    defines: [
      "ZLIB_COMPAT",
      "WITH_GZFILEOP",
      "WITH_OPTIM",
      "INFLATE_STRICT",
      "HAVE_ATTRIBUTE_ALIGNED",
      "HAVE_BUILTIN_ASSUME_ALIGNED",
      "HAVE_BUILTIN_CTZ",
      "HAVE_BUILTIN_CTZLL",
      "HAVE_VISIBILITY_HIDDEN",
      "HAVE_VISIBILITY_INTERNAL",
      "HAVE_POSIX_MEMALIGN",
      "_LARGEFILE64_SOURCE=1",
      "__USE_LARGEFILE64",
      "HAVE_SYS_AUXV_H",
      "X86_FEATURES",
      // Not X86_HAVE_XSAVE_INTRIN: there is no _xgetbv here.
      "HAVE_CPUID_GNU",
      "X86_SSE2",
      "X86_SSSE3",
      "X86_SSE41",
    ],
    sources: ["*.c", "arch/generic/*.c", "arch/x86/*.c", "test/*.c", "tools/*.c"],
    skip: [["arch/x86/slide_hash_avx2.c", "AVX2 (256-bit vector) intrinsics; its only guard is the build system"]],
  },
  {
    name: "libdeflate",
    root: "$VENDOR/libdeflate",
    includeDirs: ["."],
    defines: [],
    sources: ["lib/**.c", "programs/*.c"],
    skip: [],
  },
  {
    name: "brotli",
    root: "$VENDOR/brotli",
    includeDirs: ["c/include"],
    defines: [],
    sources: ["c/**.c"],
    skip: [],
  },
  {
    name: "zstd",
    root: "$VENDOR/zstd",
    includeDirs: ["lib", "lib/common", "lib/compress", "programs", "zlibWrapper"],
    defines: ["ZSTD_MULTITHREAD", "ZSTD_LEGACY_SUPPORT=0", "ZSTD_DISABLE_ASM=1", "XXH_NAMESPACE=ZSTD_"],
    sources: ["lib/**.c", "programs/*.c", "examples/*.c", "tests/*.c", "zlibWrapper/*.c"],
    skip: [],
  },
  {
    name: "cares",
    root: "$VENDOR/cares",
    includeDirs: ["include", "src/lib", "src/lib/include", "$BUILD/cares"],
    defines: [
      "HAVE_CONFIG_H=1",
      "CARES_BUILDING_LIBRARY",
      "_GNU_SOURCE",
      "_POSIX_C_SOURCE=200809",
      "_XOPEN_SOURCE=700",
    ],
    sources: ["src/lib/**.c", "src/tools/*.c"],
    skip: [],
  },
  {
    name: "libarchive",
    root: "$VENDOR/libarchive",
    includeDirs: ["libarchive", "$BUILD/zlib", "$BUILD/libarchive"],
    defines: ["HAVE_CONFIG_H=1", "LIBARCHIVE_STATIC=1", "__LIBARCHIVE_ENABLE_VISIBILITY"],
    sources: ["libarchive/*.c"],
    skip: [],
  },
  {
    name: "mimalloc",
    root: "$VENDOR/mimalloc",
    includeDirs: ["include"],
    defines: [
      "MI_STATIC_LIB",
      "MI_SKIP_COLLECT_ON_EXIT=1",
      "MI_NO_PROCESS_DETACH=1",
      "MI_BUILD_RELEASE",
      "MI_DEFAULT_ALLOW_THP=0",
      "MI_MALLOC_OVERRIDE",
      "MI_CMAKE_BUILD_TYPE=release",
      // mimalloc's mi_atomic_pause for a compiler that is neither GNU C nor MSVC names two
      // identifiers only its MSVC wrapper defines; these are their C11 spellings.
      "mi_atomic_thread_fence=atomic_thread_fence",
      "mi_memory_order_seq_cst=memory_order_seq_cst",
    ],
    sources: ["src/*.c", "src/prim/*.c", "test/*.c"],
    skip: [
      ["src/free.c", "a fragment that alloc.c includes"],
      ["src/alloc-override.c", "a fragment that alloc.c includes"],
      ["src/page-queue.c", "a fragment that page.c includes"],
      ["test/test-commit-fail.c", "needs a debug build of mimalloc (MI_DEBUG > 0)"],
      ["test/main-override.c", "calls _expand, which only the Windows C runtime has"],
    ],
  },
  {
    name: "lshpack",
    root: "$VENDOR/lshpack",
    includeDirs: [".", "deps/xxhash"],
    defines: ['XXH_HEADER_NAME="xxhash.h"', "LS_HPACK_USE_LARGE_TABLES=1", "LS_HPACK_BSS_LARGE_TABLES=1"],
    sources: ["*.c", "deps/xxhash/*.c", "bin/*.c", "test/*.c"],
    skip: [],
  },
  {
    name: "lsqpack",
    root: "$VENDOR/lsqpack",
    includeDirs: [".", "deps/xxhash", "test"],
    defines: ['XXH_HEADER_NAME="xxhash.h"', 'TEST_DATA="testdata"'],
    sources: ["*.c", "deps/xxhash/*.c", "bin/*.c", "test/*.c"],
    skip: [],
  },
  {
    name: "hdrhistogram",
    root: "$VENDOR/hdrhistogram",
    includeDirs: ["include", "src", "$BUILD/zlib"],
    defines: ["HDR_NO_AVX2_DISPATCH", "_GNU_SOURCE"],
    sources: ["src/*.c", "examples/*.c", "test/*.c"],
    skip: [],
  },
  {
    name: "libspng",
    root: "$VENDOR/libspng",
    includeDirs: ["spng", "$BUILD/zlib"],
    defines: ["SPNG_STATIC", "SPNG_SSE=4"],
    sources: ["spng/*.c", "examples/*.c", "tests/*.c"],
    skip: [],
  },
  {
    name: "libwebp",
    root: "$VENDOR/libwebp",
    includeDirs: [".", "src"],
    defines: [],
    sources: ["src/**.c", "sharpyuv/*.c", "extras/*.c", "imageio/*.c", "examples/*.c"],
    skip: [],
  },
  {
    name: "libjpeg-turbo",
    root: "$VENDOR/libjpeg-turbo",
    includeDirs: ["src", "$BUILD/libjpeg-turbo"],
    defines: ["BUN_8BIT_ONLY", "USE_CLZ_INTRINSIC"],
    sources: ["src/*.c", "simd/*.c"],
    skip: [
      ["src/jccolext.c", "a fragment that jccolor.c includes once per pixel format"],
      ["src/jdcolext.c", "a fragment that jdcolor.c includes once per pixel format"],
      ["src/jdcol565.c", "a fragment that jdcolor.c includes"],
      ["src/jdmrgext.c", "a fragment that jdmerge.c includes once per pixel format"],
      ["src/jdmrg565.c", "a fragment that jdmerge.c includes"],
      ["src/jstdhuff.c", "a fragment that jcparam.c and jdhuff.c include"],
      ["src/turbojpeg-mp.c", "a fragment that turbojpeg.c includes once per sample size"],
    ],
  },
  {
    name: "libuv",
    root: "$VENDOR/libuv",
    includeDirs: ["include", "src"],
    defines: ["_GNU_SOURCE", "_POSIX_C_SOURCE=200112", "_FILE_OFFSET_BITS=64", "_LARGEFILE_SOURCE"],
    sources: ["src/*.c", "src/unix/*.c", "test/*.c", "docs/code/**.c"],
    skip: [
      ["src/unix/aix.c", "AIX"],
      ["src/unix/aix-common.c", "AIX"],
      ["src/unix/ibmi.c", "IBM i"],
      ["src/unix/os390.c", "z/OS"],
      ["src/unix/os390-syscalls.c", "z/OS"],
      ["src/unix/os390-proctitle.c", "z/OS"],
      ["src/unix/darwin.c", "macOS"],
      ["src/unix/darwin-proctitle.c", "macOS"],
      ["src/unix/fsevents.c", "macOS"],
      ["src/unix/kqueue.c", "macOS and the BSDs"],
      ["src/unix/bsd-ifaddrs.c", "the BSDs"],
      ["src/unix/bsd-proctitle.c", "the BSDs"],
      ["src/unix/freebsd.c", "FreeBSD"],
      ["src/unix/netbsd.c", "NetBSD"],
      ["src/unix/openbsd.c", "OpenBSD"],
      ["src/unix/random-getentropy.c", "the BSDs and macOS"],
      ["src/unix/sunos.c", "Solaris"],
      ["src/unix/haiku.c", "Haiku"],
      ["src/unix/hurd.c", "GNU Hurd"],
      ["src/unix/qnx.c", "QNX"],
      ["src/unix/cygwin.c", "Cygwin"],
      ["src/unix/posix-poll.c", "platforms without epoll or kqueue"],
      ["test/runner-win.c", "Windows"],
    ],
  },
  {
    name: "tinycc",
    root: "$VENDOR/tinycc",
    includeDirs: [".", "include", "$BUILD/tinycc"],
    defines: [
      "CONFIG_TCC_PREDEFS",
      "ONE_SOURCE=1",
      'TCC_LIBTCC1=""',
      "CONFIG_TCC_BACKTRACE=0",
      'TCC_VERSION="corpus"',
      'TCC_GITHASH="corpus"',
    ],
    sources: ["tcc.c", "lib/*.c", "tests/tests2/*.c"],
    skip: [
      ["tcc.c", "80-bit long double arithmetic: tcc folds floating constants in long double"],
      ["lib/libtcc1.c", "80-bit long double arithmetic"],
      ["lib/lib-arm64.c", "long double (the AArch64 quad soft-float routines)"],
      ["lib/armeabi.c", "32-bit ARM, with top-level inline assembly"],
      ["lib/lib-riscv.c", "RISC-V"],
      ["lib/bt-dll.c", "Windows"],
      ["lib/bt-exe.c", "needs the definitions tccrun.c has when built with CONFIG_TCC_BACKTRACE_ONLY"],
      ["tests/tests2/101_cleanup.c", "80-bit long double arithmetic"],
      ["tests/tests2/111_conversion.c", "80-bit long double arithmetic"],
      ["tests/tests2/22_floating_point.c", "80-bit long double arithmetic"],
      ["tests/tests2/73_arm64.c", "long double (static initializers)"],
      ["tests/tests2/85_asm-outside-function.c", "inline assembly"],
      ["tests/tests2/98_al_ax_extend.c", "inline assembly"],
      ["tests/tests2/99_fastcall.c", "inline assembly"],
      ["tests/tests2/127_asm_goto.c", "inline assembly"],
      ["tests/tests2/138_arm64_encoding.c", "inline assembly"],
      ["tests/tests2/140_arm64_extasm.c", "inline assembly"],
      ["tests/tests2/145_winarm64_interlocked.c", "Windows"],
      ["tests/tests2/34_array_assignment.c", "assigns to an array: a tcc extension GCC rejects too"],
      ["tests/tests2/102_alignas.c", "implicit int: a tcc leniency GCC 14 rejects too"],
    ],
  },
  {
    name: "tinycc-units",
    root: "$VENDOR/tinycc",
    includeDirs: [".", "include", "$BUILD/tinycc"],
    defines: [
      "CONFIG_TCC_PREDEFS",
      "ONE_SOURCE=0",
      'TCC_LIBTCC1=""',
      "CONFIG_TCC_BACKTRACE=0",
      'TCC_VERSION="corpus"',
      'TCC_GITHASH="corpus"',
    ],
    // The way Bun builds it: one unit per file.
    sources: [
      "libtcc.c",
      "tccpp.c",
      "tccgen.c",
      "tccdbg.c",
      "tccelf.c",
      "tccasm.c",
      "tccrun.c",
      "x86_64-gen.c",
      "x86_64-link.c",
      "i386-asm.c",
    ],
    skip: [
      ["tccpp.c", "80-bit long double arithmetic: floating constants are assembled in long double"],
      ["tccgen.c", "80-bit long double arithmetic: constant folding"],
    ],
  },
  {
    name: "lsquic",
    root: "$VENDOR/lsquic",
    includeDirs: [
      "include",
      "src/liblsquic",
      "$VENDOR/boringssl/include",
      "$VENDOR/lshpack",
      "$VENDOR/lshpack/deps/xxhash",
      "$VENDOR/lsqpack",
      "$BUILD/zlib",
      "$VENDOR/zlib",
    ],
    defines: [
      // Written for GNU C only (see `compile_one`).
      "__GNUC__=4",
      "HAVE_BORINGSSL=1",
      'XXH_HEADER_NAME="xxhash.h"',
      "LS_QPACK_USE_LARGE_TABLES=1",
      "LS_HPACK_BSS_LARGE_TABLES=1",
      'LSQPACK_ENC_LOGGER_HEADER="lsquic_qpack_enc_logger.h"',
      'LSQPACK_DEC_LOGGER_HEADER="lsquic_qpack_dec_logger.h"',
      "LSQUIC_DEBUG_NEXT_ADV_TICK=0",
      "LSQUIC_CONN_STATS=1",
      "LSQUIC_QIR=0",
      "LSQUIC_WEBTRANSPORT_SERVER_SUPPORT=0",
      "LSQUIC_LOWEST_LOG_LEVEL=LSQ_LOG_INFO",
    ],
    sources: ["src/liblsquic/*.c"],
    skip: [
      ["src/liblsquic/common_cert_set_2.c", "a fragment that lsquic_crt_compress.c includes"],
      ["src/liblsquic/common_cert_set_3.c", "a fragment that lsquic_crt_compress.c includes"],
    ],
  },
  {
    name: "openssl",
    root: "$NODE/openssl",
    includeDirs: [
      "config/archs/linux-x86_64/no-asm/include",
      "config/archs/linux-x86_64/no-asm",
      "config/archs/linux-x86_64/no-asm/providers/common/include",
      "openssl",
      "openssl/include",
      "openssl/crypto",
      "openssl/crypto/include",
      "openssl/crypto/modes",
      "openssl/crypto/ec/curve448",
      "openssl/crypto/ec/curve448/arch_32",
      "openssl/providers/common/include",
      "openssl/providers/fips/include",
      "openssl/providers/implementations/include",
      "config",
      "$NODE/brotli/c/include",
      "$NODE/zlib",
      "$NODE/zstd/lib",
    ],
    defines: [
      "NDEBUG",
      "OPENSSL_USE_NODELETE",
      "L_ENDIAN",
      "OPENSSL_BUILDING_OPENSSL",
      "BROTLI",
      "ZLIB",
      "ZSTD",
      "OPENSSL_PIC",
      "OPENSSL_NO_ASM",
      'OPENSSLDIR="/etc/ssl"',
      'ENGINESDIR="/dev/null"',
      'MODULESDIR="/usr/lib/ossl-modules"',
      "OPENSSL_API_COMPAT=0x10100001L",
      "STATIC_LEGACY",
    ],
    // The library as Node builds it for linux-x86_64 without assembly.
    sources: ["@config/archs/linux-x86_64/no-asm/openssl.gypi"],
    skip: [
      ["openssl/crypto/cversion.c", "needs buildinf.h, which the build writes"],
      ["openssl/crypto/info.c", "needs buildinf.h, which the build writes"],
    ],
  },
  {
    name: "nghttp2",
    root: "$NODE/nghttp2",
    includeDirs: ["lib/includes", "lib"],
    defines: ["BUILDING_NGHTTP2", "NGHTTP2_STATICLIB", "HAVE_CONFIG_H", "_U_="],
    sources: ["lib/*.c"],
    skip: [],
  },
  {
    name: "ngtcp2",
    root: "$NODE/ngtcp2",
    includeDirs: [
      ".",
      "ngtcp2/lib/includes",
      "ngtcp2/crypto/includes",
      "ngtcp2/lib",
      "ngtcp2/crypto",
      "nghttp3/lib/includes",
      "nghttp3/lib",
      "$NODE/openssl/config/archs/linux-x86_64/no-asm/include",
      "$NODE/openssl/openssl/include",
    ],
    defines: [
      "BUILDING_NGTCP2",
      "NGTCP2_STATICLIB",
      "BUILDING_NGHTTP3",
      "NGHTTP3_STATICLIB",
      "HAVE_UNISTD_H",
      "HAVE_ARPA_INET_H",
      "HAVE_NETINET_IN_H",
      "_U_=",
    ],
    sources: ["@ngtcp2.gyp"],
    skip: [["ngtcp2/crypto/boringssl/boringssl.c", "the BoringSSL backend; Node builds the OpenSSL one"]],
  },
  {
    name: "llhttp",
    root: "$NODE/llhttp",
    includeDirs: [".", "include"],
    defines: [],
    sources: ["src/*.c"],
    skip: [],
  },
  {
    name: "uvwasi",
    root: "$NODE/uvwasi",
    includeDirs: ["include", "$NODE/uv/include"],
    defines: ["_GNU_SOURCE", "_POSIX_C_SOURCE=200112"],
    sources: ["src/*.c"],
    skip: [],
  },
  {
    name: "zlib-classic",
    root: "$NODE/zlib",
    includeDirs: ["."],
    defines: [
      "ZLIB_IMPLEMENTATION",
      "HAVE_HIDDEN",
      // What zlib.gyp adds on x64.
      "ADLER32_SIMD_SSSE3",
      "X86_NOT_WINDOWS",
      "INFLATE_CHUNK_SIMD_SSE2",
      "INFLATE_CHUNK_READ_64LE",
    ],
    sources: ["*.c", "contrib/optimizations/*.c"],
    skip: [],
  },
  {
    name: "cares-node",
    root: "$NODE/cares",
    includeDirs: ["include", "src/lib", "src/lib/include", "config/linux"],
    defines: [
      // Written for GNU C only (see `compile_one`).
      "__GNUC__=4",
      "HAVE_CONFIG_H",
      "CARES_BUILDING_LIBRARY",
      "_LARGEFILE_SOURCE",
      "_FILE_OFFSET_BITS=64",
      "_GNU_SOURCE",
    ],
    sources: ["src/lib/**.c"],
    skip: [],
  },
  {
    name: "libpas",
    root: "$WEBKIT/Source/bmalloc/libpas/src/libpas",
    includeDirs: ["."],
    defines: [
      // Written for GNU C only (see `compile_one`).
      "__GNUC__=4",
      "_GNU_SOURCE",
    ],
    sources: ["*.c"],
    skip: [],
  },
  {
    name: "compiler-rt",
    root: "$LLVM/compiler-rt/lib/builtins",
    includeDirs: ["."],
    defines: [
      // Written for GNU C only (see `compile_one`).
      "__GNUC__=4",
    ],
    sources: ["*.c"],
    skip: [
      ["extendhfxf2.c", "long double"],
      ["fixunsxfdi.c", "long double"],
      ["fixunsxfsi.c", "long double"],
      ["fixunsxfti.c", "long double"],
      ["fixxfdi.c", "long double"],
      ["fixxfti.c", "long double"],
      ["floatdixf.c", "long double"],
      ["floattixf.c", "long double"],
      ["floatundixf.c", "long double"],
      ["floatuntixf.c", "long double"],
      ["truncxfhf2.c", "long double"],
      ["divxc3.c", "long double"],
      ["mulxc3.c", "long double"],
      ["powixf2.c", "long double"],
      ["truncdfbf2.c", "the __bf16 type"],
      ["truncsfbf2.c", "the __bf16 type"],
      ["gcc_personality_v0.c", "C++ exception handling (__builtin_eh_return_data_regno)"],
      ["crtbegin.c", "top-level inline assembly"],
      ["atomic.c", "the runtime's own 16-byte atomic operations, written with the builtins"],
    ],
  },
  {
    name: "boringssl",
    root: "$VENDOR/boringssl",
    includeDirs: ["include"],
    defines: ["BORINGSSL_IMPLEMENTATION", "OPENSSL_NO_ASM"],
    sources: ["crypto/**.c", "ssl/**.c"],
    skip: [],
  },
];

/** The `.c` files under `dir` of `root`, relative to `root`, sorted. */
function walk(root: string, dir: string, recursive: boolean, out: string[]) {
  const full = dir ? join(root, dir) : root;
  if (!existsSync(full)) return;
  const entries = readdirSync(full, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (recursive && !entry.name.startsWith(".")) walk(root, relative, true, out);
    } else if (entry.name.endsWith(".c")) out.push(relative);
  }
}

function skipReason(library: Library, relative: string) {
  for (const [pattern, reason] of library.skip) {
    const matches = pattern.startsWith("*")
      ? relative.endsWith(pattern.slice(1))
      : pattern.endsWith("/")
        ? relative.startsWith(pattern)
        : relative === pattern;
    if (matches) return reason;
  }
}

/** The files of `library` to compile, in order. */
function filesOf(library: Library, root: string) {
  const found: string[] = [];
  for (const pattern of library.sources) {
    if (pattern.endsWith("**.c")) walk(root, pattern.slice(0, -"**.c".length).replace(/\/+$/, ""), true, found);
    else if (pattern.endsWith("*.c")) walk(root, pattern.slice(0, -"*.c".length).replace(/\/+$/, ""), false, found);
    else if (pattern.startsWith("@")) {
      const list = join(root, pattern.slice(1));
      const text = existsSync(list) ? readFileSync(list, "utf8") : "";
      // Every '...' or "..." that names a .c file.
      for (const [, , name] of text.matchAll(/(['"])([^'"\n]*)\1/g)) {
        if (name.endsWith(".c") && !name.startsWith("<")) found.push(name.replace(/^(\.\/)+/, ""));
      }
    } else found.push(pattern);
  }
  return [...new Set(found)].sort().filter(relative => !skipReason(library, relative));
}

// Claiming to be GNU C 9, the way `-fgnuc-version=9.0.0` does for bun-cc (macOS targets claim it already).
const gnuC9 = `#ifndef __GNUC__
#define __GNUC__ 9
#define __GNUC_MINOR__ 0
#define __GNUC_PATCHLEVEL__ 0
#define __GNUC_STDC_INLINE__ 1
#define __OPTIMIZE__ 1
#undef __REDIRECT
#undef __REDIRECT_NTH
#undef __REDIRECT_NTHNL
#endif
`;

/** Names and numbers out of a message, so that the same complaint about different things is one class. */
const messageClass = (message: string) => message.replace(/'[^']*'/g, "'…'");

/**
 * What is known not to compile, and why: `[library, file or *suffix, a piece of the message]`. Each is asserted
 * to fail that way still, so that the day it compiles is noticed.
 */
const expectedFailures: [string, string, string][] = [
  // libpas (WebKit's allocator) is the one library with files this compiler does not take, for three reasons.
  // Heap configurations are static initializers that call always-inline functions on the addresses of other objects:
  ["libpas", "bmalloc_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "bmalloc_heap_utils.c", "initializer element is not a compile-time constant"],
  ["libpas", "hotbit_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "hotbit_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "iso_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "iso_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "iso_test_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "iso_test_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "jit_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "minalign32_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "minalign32_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "pagesize64k_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "pagesize64k_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "pas_bitfit_page_config_kind.c", "initializer element is not a compile-time constant"],
  ["libpas", "pas_heap_config_kind.c", "initializer element is not a compile-time constant"],
  ["libpas", "pas_segregated_page_config_kind.c", "initializer element is not a compile-time constant"],
  ["libpas", "tagged_bmalloc_heap_config.c", "initializer element is not a compile-time constant"],
  ["libpas", "tagged_bmalloc_heap_utils.c", "initializer element is not a compile-time constant"],
  ["libpas", "thingy_heap.c", "initializer element is not a compile-time constant"],
  ["libpas", "thingy_heap_config.c", "initializer element is not a compile-time constant"],
  // an `asm` statement that calls a C function by name (`call pas_segregated_page_deallocation_did_fail`):
  ["libpas", "jit_heap_config.c", "inline assembly: "],
  ["libpas", "pas_deallocate.c", "inline assembly: "],
  ["libpas", "pas_thread_local_cache.c", "inline assembly: "],
  ["libpas", "pas_utility_heap.c", "inline assembly: "],
  ["libpas", "pas_utility_heap_config.c", "inline assembly: "],
  // and 16-byte compare-and-swap, which BIR has no instruction for:
  ["libpas", "pas_bitfit_allocator.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_bitfit_directory.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_bitfit_size_class.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_page_sharing_pool.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_segregated_directory.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_segregated_size_directory.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_versioned_field.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_lock_free_read_ptr_ptr_hashtable.c", "there are no 16-byte atomic operations"],
  ["libpas", "pas_segregated_page.c", "there are no 16-byte atomic operations"],
];
/**
 * The same for the pass that claims GNU C 9: code that takes a claim of GNU C as a promise of everything GCC has.
 * (macOS targets make the claim themselves, so there the first pass has these too.)
 */
const expectedFailuresAsGnuC: [string, string, string][] = [
  ...expectedFailures,
  // libdeflate reads "GCC 9" as "has the AVX2, PCLMULQDQ and BMI2 intrinsics", and chooses among them at run time.
  ["libdeflate", "lib/adler32.c", "lib/x86/adler32_template.h"],
  ["libdeflate", "lib/crc32.c", "_mm_clmulepi64_si128"],
  ["libdeflate", "lib/deflate_decompress.c", "_bzhi_u64"],
  // tinycc's runtime library has a function written in file-scope assembly for GNU C.
  ["tinycc", "lib/builtin.c", "inline assembly is not supported yet"],
];

const expectationFor = (table: [string, string, string][], library: string, relative: string) =>
  table.find(
    ([name, pattern]) =>
      name === library && (pattern.startsWith("*") ? relative.endsWith(pattern.slice(1)) : relative === pattern),
  )?.[2];

/** `bun build` of every file of `library`, some at a time; what did not compile, by file. */
async function compileAll(library: Library, root: string, files: string[], asGnuC: boolean) {
  const includeDirs = library.includeDirs.map(dir =>
    dir.startsWith("$") || dir.startsWith("/") ? expand(dir) : dir === "." ? root : join(root, dir),
  );
  // (`__GNUC__=4` in the table means "only ever as GNU C": -fgnuc-version=4.2.1 for the tool this came from.)
  const onlyGnuC = library.defines.some(define => define.startsWith("__GNUC__"));
  const defines = library.defines.filter(define => !define.startsWith("__GNUC"));
  const prefix = asGnuC || onlyGnuC ? gnuC9 : "";
  const wrappers: Record<string, string> = {};
  files.forEach(
    (relative, index) => (wrappers[`unit${index}.c`] = prefix + wrapperSource(defines, join(root, relative))),
  );
  using dir = tempDir(`bir-corpus-${library.name}`, wrappers);
  const env = { ...bunEnv, C_INCLUDE_PATH: includePath(...includeDirs) };
  const failures = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const { exitCode, stderr } = await run(
        String(dir),
        ["build", "--target", "bun", `unit${index}.c`, "--outdir", `out${index}`],
        env,
      );
      if (exitCode === 0) continue;
      const errors = stderr.split("\n").filter(line => line.includes("error: "));
      // A unit that only declares a thread-local object another unit defines is fine: it needs linking.
      if (
        errors.length > 0 &&
        errors.every(line => /thread-local variable .* not defined in any translation unit/.test(line))
      )
        continue;
      const first = errors[0] ?? stderr.trim().split("\n")[0] ?? `exit code ${exitCode}`;
      failures.set(files[index], first.replace(/^error: /, "").replaceAll(String(dir), "."));
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), 16, files.length) }, worker));
  return failures;
}

function report(
  library: Library,
  files: string[],
  failures: Map<string, string>,
  expected: [string, string, string][],
) {
  const unexpected: string[] = [];
  const classes = new Map<string, number>();
  for (const [relative, message] of failures) {
    const piece = expectationFor(expected, library.name, relative);
    if (piece !== undefined && message.includes(piece)) continue;
    const kind = messageClass(message.replace(/^.*?: error: /, ""));
    classes.set(kind, (classes.get(kind) ?? 0) + 1);
    unexpected.push(`${relative}: ${message}`);
  }
  const compiledAfterAll = files.filter(
    relative => expectationFor(expected, library.name, relative) !== undefined && !failures.has(relative),
  );
  const summary = [...classes].map(([kind, count]) => `${count} x ${kind}`).join("\n");
  expect(
    unexpected,
    `${unexpected.length} of ${files.length} files of ${library.name} did not compile:\n${summary}\n`,
  ).toEqual([]);
  expect(compiledAfterAll, "these are listed as not compiling, and compile now").toEqual([]);
}

describe.skipIf(!heavy)("the corpus compiles, file by file, through bun build", () => {
  for (const library of LIBRARIES) {
    const root = expand(library.root);
    const files = existsSync(root) ? filesOf(library, root) : [];
    // A library whose configuration headers were never generated (no build of Bun here) is not there either.
    const configured = library.includeDirs
      .filter(dir => dir.startsWith("$BUILD"))
      .every(dir => existsSync(expand(dir)));
    describe.skipIf(files.length === 0 || !configured)(library.name, () => {
      test(
        `${files.length} files`,
        async () => report(library, files, await compileAll(library, root, files, false), expectedFailures),
        600_000,
      );
      test(
        "claiming GNU C 9",
        async () => report(library, files, await compileAll(library, root, files, true), expectedFailuresAsGnuC),
        600_000,
      );
    });
  }
});
