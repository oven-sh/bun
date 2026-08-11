/**
 * Configure-time checks for the x86 SIMD wiring in scripts/build/deps/libwebp.ts.
 *
 * libwebp's dsp dispatchers (src/dsp/lossless.c, lossless_enc.c, dec.c, ...)
 * only compile their `if (VP8GetCPUInfo(kAVX2)) VP8LDspInitAVX2();` call when
 * WEBP_HAVE_AVX2 is defined in the dispatcher's own TU. Upstream gets that from
 * config.h; bun builds libwebp without one and at -march=nehalem, so the
 * define has to come from the dep spec. Without it the *_avx2.c kernels are
 * still compiled (with -mavx2) but nothing ever calls them in the linux and
 * macOS x64 builds (clang-cl's _MSC_VER makes cpu.h imply the define on
 * Windows).
 *
 * libwebp.build() only reads cfg.x64, so the spec is built from a partial
 * Config (as test/js/bun/perf/linker-order.test.ts does); no toolchain or
 * compiler is involved.
 */
import { describe, expect, test } from "bun:test";

import type { Config } from "../../../scripts/build/config.ts";
import { libwebp } from "../../../scripts/build/deps/libwebp.ts";
import type { DirectBuild } from "../../../scripts/build/source.ts";

function libwebpBuild(x64: boolean): DirectBuild {
  const spec = libwebp.build({ x64 } as Config);
  if (spec.kind !== "direct") throw new Error(`expected libwebp to be a direct build, got ${spec.kind}`);
  return spec;
}

/** The WEBP_HAVE_<ISA> macros the spec defines for every TU, sorted. */
function haveDefines(spec: DirectBuild): string[] {
  return Object.keys(spec.defines ?? {})
    .filter(name => name.startsWith("WEBP_HAVE_"))
    .sort();
}

/** source path -> per-file cflags (bare-string sources have none). */
function perFileFlags(spec: DirectBuild): Map<string, string[]> {
  return new Map(spec.sources.map(s => (typeof s === "string" ? [s, []] : [s.path, s.cflags])));
}

/** Sources whose per-file cflags include `flag`, sorted. */
function sourcesWithFlag(spec: DirectBuild, flag: string): string[] {
  return [...perFileFlags(spec)]
    .filter(([, cflags]) => cflags.includes(flag))
    .map(([path]) => path)
    .sort();
}

/** The per-file flag each kernel-file suffix gets; every other file gets none. */
const flagForSuffix: Array<[suffix: string, flag: string]> = [
  ["_avx2.c", "-mavx2"],
  ["_sse41.c", "-msse4.1"],
  ["_sse2.c", "-msse2"],
];

const isaFlags: Record<string, string> = {
  WEBP_HAVE_SSE2: "-msse2",
  WEBP_HAVE_SSE41: "-msse4.1",
  WEBP_HAVE_AVX2: "-mavx2",
};

describe("libwebp x86 SIMD wiring", () => {
  test("x64 tells the dispatchers about every ISA level it builds kernels for", () => {
    const spec = libwebpBuild(true);
    expect(haveDefines(spec)).toEqual(["WEBP_HAVE_AVX2", "WEBP_HAVE_SSE2", "WEBP_HAVE_SSE41"]);

    // The define and the kernels have to travel together: a level that is
    // compiled but not announced is dead code (the bug this guards against),
    // and one that is announced but not compiled makes the dispatcher call
    // libwebp's empty stub Init.
    for (const [define, flag] of Object.entries(isaFlags)) {
      expect(spec.defines).toMatchObject({ [define]: true });
      expect(sourcesWithFlag(spec, flag)).not.toBeEmpty();
    }
  });

  test("x64 defines WEBP_HAVE_AVX2 without raising any non-kernel TU above the baseline -march", () => {
    const spec = libwebpBuild(true);
    const flags = perFileFlags(spec);

    // The dispatchers that consume WEBP_HAVE_AVX2 are built at the baseline
    // -march; the runtime cpuid check in dsp/cpu.c is what keeps the AVX2
    // kernels off pre-AVX2 CPUs, so -mavx2 must reach exactly the kernel TUs.
    expect(flags.get("src/dsp/lossless.c")).toEqual([]);
    expect(flags.get("src/dsp/lossless_enc.c")).toEqual([]);
    expect(sourcesWithFlag(spec, "-mavx2")).toEqual(["src/dsp/lossless_avx2.c", "src/dsp/lossless_enc_avx2.c"]);
    expect(spec.cflags ?? []).not.toContain("-mavx2");

    const expected = [...flags.keys()].map((path): [string, string[]] => {
      const match = flagForSuffix.find(([suffix]) => path.endsWith(suffix));
      return [path, match === undefined ? [] : [match[1]]];
    });
    expect([...flags]).toEqual(expected);
  });

  test("arm64 gets neither the x86 defines nor the x86 -m flags", () => {
    const spec = libwebpBuild(false);
    expect(haveDefines(spec)).toEqual([]);
    expect(spec.sources.filter(s => typeof s !== "string")).toEqual([]);
    // The x86 kernel files are still listed; cpu.h turns them into stub Inits there.
    expect(spec.sources).toContain("src/dsp/lossless_avx2.c");
    expect(spec.sources).toContain("src/dsp/lossless_enc_avx2.c");
  });
});
