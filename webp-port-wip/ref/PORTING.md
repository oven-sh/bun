# Porting libwebp v1.6.0 to safe Rust (`bun_webp`, `src/webp/` in the Bun repo)

Bun is replacing its C dependencies with safe Rust. libwebp has already been removed from Bun's build. The crate
`src/webp` (`bun_webp`) replaces it. The bar: **the same pixels out of the decoder, the same accept/reject decision for
every input, and byte-for-byte the same files out of the encoder as libwebp v1.6.0**, with no `unsafe` and no way to
panic. There is no deadline. Correctness, then clean code, then speed.

## What Bun uses (everything else is out of scope and must NOT be ported)

`dead_code` is a hard error in this workspace, so only code that can be reached from these entry points may exist:

| libwebp | `bun_webp` (see `src/webp/lib.rs`) |
| --- | --- |
| `WebPGetInfo` | `get_info` |
| `WebPDecodeRGBAInto` (no options: MODE_RGBA, fancy upsampling, no dithering, no cropping/scaling, no threads, not incremental) | `decode_rgba_into` |
| `WebPEncodeRGBA(quality)` | `encode_rgba(.., Compression::Lossy { quality }, ..)` |
| `WebPEncodeLosslessRGBA` | `encode_rgba(.., Compression::Lossless, ..)` |
| demux/mux, only to read/attach an ICCP chunk | done by the coordinator |

The two encoder entry points go through `Encode()` in `src/enc/picture_enc.c`, so the `WebPConfig` is always
`WebPConfigPreset(WEBP_PRESET_DEFAULT, quality)`:
method 4, sns_strength 50, filter_strength 60, filter_sharpness 0, filter_type 1, autofilter 0, partitions 0,
segments 4, pass 1, qmin 0, qmax 100, target_size 0, target_PSNR 0, preprocessing 0, partition_limit 0,
alpha_compression 1, alpha_filtering 1, alpha_quality 100, exact 0, image_hint DEFAULT, emulate_jpeg_size 0,
thread_level 0, low_memory 0, near_lossless 100, use_sharp_yuv 0, no `stats`, no `extra_info`, no progress hook.
Lossless: same, with `lossless = 1`, `quality = 70`, `use_argb = 1`.
The alpha plane of a lossy image is compressed by the lossless encoder with the settings `EncodeAlphaInternal` picks.

Fold these constants in. A branch that these settings can never take is not ported (trellis, multi-pass size search,
`method` 0-3/5-6 paths, near-lossless, sharp YUV, autofilter, stats, rescaler, threads, incremental decoding, YUV(A) and
other RGB output modes, dithering...). Where a value differs between the callers that do exist (e.g. the lossless
encoder's `quality`/`method` for images vs. alpha planes) keep it a parameter. When in doubt whether something is
reachable, find out (read the callers, or put an `abort()` in a private copy of the C code and run the corpus).

## Where things are

- C source, read-only, shared: `/root/ref/libwebp` (exactly the commit Bun used).
- Reference static library + shim, shared, do not modify: `/root/ref/build/libwebp_ref.a` (`build.sh`, `shim.c` there).
  It is built like Bun built it, so it uses SSE2/SSE4.1/AVX2. `WEBP_DIFF_NOSIMD=1` makes the harness switch it to plain C.
  The two are meant to be bit-exact; if you find a case where they are not, match plain C and report it.
- To trace the C code (printf, abort, dumping intermediate buffers), make a PRIVATE copy:
  `cp -r /root/ref/libwebp /root/ref/build <your dir>`, fix the paths at the top of your `build.sh` and in your harness's
  `build.rs`. Comparing intermediate state (per macroblock, per histogram, per bit-writer call...) against a traced C
  build is by far the fastest way to find the first point of divergence. Do that instead of staring at code.
- Harness template: `/root/ref/harness`. `/root/ref/new-harness.sh <your checkout>` copies it to
  `<your checkout>/target/webp-diff` (git-ignored), bound to that checkout's `src/webp`, and symlinks `vendor/`.
  Usage is at the top of its `src/main.rs`. Extend your copy freely.
  Build/run: `. ~/.bun-dev-env && cd <checkout>/target/webp-diff && cargo build --release && ./target/release/webp-diff ...`
  (optimised, but integer overflow checks and `debug_assert!` are ON, and a panic aborts).
- Pixel sources from real photos/screenshots/icons, some with alpha: `/root/ref/corpus/img/*.webp` (`lossy-img`, `lossless-img`).
- Decoder corpus: `/root/ref/corpus/dec/*.webp`, 1500 files from the reference's advanced encoder with random settings
  (`*-vp8.webp` lossy, with and without ALPH; `*-ll.webp` lossless). `gen` makes more with another seed, into your own directory.
- Lint (must be clean): `. ~/.bun-dev-env && cd <checkout> && cargo clippy -p bun_webp` and `cargo fmt -p bun_webp`.
  Every shell command needs `. ~/.bun-dev-env &&` first (environment does not persist between commands).
- Do not run `bun bd`/`bun run build`/ninja: another build is using the machine and the build directory.

## Hard rules

1. `#![forbid(unsafe_code)]`. No `core::arch`, no `std::simd`, no inline asm, no new dependencies (the crate has none), no threads, no I/O, no globals with interior mutability (`static` tables of constants are fine; compute tables with `const fn` or write them out).
2. **Nothing may panic**, whatever the input. The crate denies `clippy::indexing_slicing`, `unwrap_used`, `expect_used`, `panic`, `unreachable`. Also forbidden although clippy does not catch them: `assert!` (use `debug_assert!`), division/remainder by a value that could be 0, shifts by >= the bit width, `copy_from_slice`/`clone_from_slice`/`split_at`/`chunks(0)` with lengths you have not made equal/valid, `RefCell`, slicing by range. Do not `#[allow]` any of these lints.
3. **Integer overflow is a bug** (it aborts debug builds). Where C relies on unsigned wrap-around use `wrapping_*` explicitly. Keep C's signedness and width wherever a value can go negative, wrap, or be shifted right. `as` between integer types must be provably lossless or deliberately truncating as in C.
4. Allocations whose size depends on the image go through `util::try_vec` / `try_reserve*` and report `OutOfMemory`. No `vec![x; n]`, `with_capacity(n)`, `resize`, `push`/`extend` without a prior `try_reserve` for those. Small fixed-size allocations may be ordinary.
5. Broken internal invariants return `util::Bug` (converts into `DecodeError::Bug` / `EncodeError::Bug` with `?`). Malformed input is never `Bug`: the harness treats `Bug` from the decoder as a failure.
6. Floating point: same type (`float` = `f32`, `double` = `f64`), same order of operations, no `mul_add`. `pow` = `powf`, `log` = `ln`, `(int)x` = `x as i32` for in-range values.
7. Only touch the files/directories assigned to you, plus `lib.rs` for `mod`/dev hooks. If you need a change elsewhere (e.g. in `util.rs`), make it minimal and list it in your report. Temporary test-only exports go in `src/webp/dev_hooks.rs` (`pub mod dev_hooks;` in `lib.rs`); the coordinator deletes that file when merging.

## Style

- Read `src/CLAUDE.md` in the checkout (Rust conventions) and look at `src/tar` and `src/histogram`, two finished ports of this kind.
- This is a port, not a transliteration. Keep libwebp's algorithms, its file/function decomposition and recognisable names (`snake_case` of the C name; drop `VP8`/`WebP` prefixes where the module says it) so a reviewer can put the two side by side; each module starts with `//! \`file_name.c\`` and one line on what it is. But use Rust's means: slices and iterators instead of pointer + length, `Vec` instead of hand-rolled arenas and linked block lists, enums instead of int codes, `Option` instead of NULL/-1, methods on structs, `Result` + `?` instead of `ok = ok && ...`/`goto Error`, ownership instead of init/clear/delete pairs. No function-pointer dispatch tables for SIMD selection: call the function.
- Comments: few. Say what a reader cannot see from the code (a format rule, a quirk kept for compatibility and why, a non-obvious invariant that makes an index valid). Do not copy libwebp's comments wholesale, do not narrate, no commented-out code, no TODOs, no references to this document, to "the C code does X here" on every line, or to how you got there.
- `pub(crate)` at most (`unreachable_pub` is denied); private where possible.
- Line width 100 (`cargo fmt`).

## Speed

libwebp's hot loops are hand-written SSE2/NEON; ours must rely on the compiler (x64 baseline is `-Ctarget-cpu=nehalem`, i.e. SSE4.2; arm64 has NEON). Get it correct first, then look at the `bench-*` commands and profile (`perf` may be unavailable; timing by section works).
- Give the optimiser fixed shapes: `&[u8; 16]`, `as_chunks`/`chunks_exact`, `zip`, `first_chunk`, `split_first_chunk`, `array_at::<N>()`; take one checked sub-slice per row or block and then iterate, instead of a checked access per sample.
- `u8`-indexed lookups into `[T; 256]` via `.at(usize::from(b))?` cost nothing: the check folds away. Prefer arithmetic (`clamp`, `min`/`max`, `abs_diff`) over libwebp's clip tables when it gives the same value; it vectorises.
- Keep per-pixel functions small and `#[inline]`; avoid `Result` in the innermost per-sample helpers when you can hoist the check.
- Do not change results for speed. Ever.

## Definition of done for a work package

- The harness commands named in your task report `0 differ` on the shared corpora, on at least 20,000 fresh synthetic cases / 2,000,000 mutants where applicable, with and without `WEBP_DIFF_NOSIMD=1`.
- `cargo clippy -p bun_webp` clean and `cargo fmt` applied. With the temporary `#![allow(dead_code)]` in `lib.rs` removed, no dead-code error points into your files (other than your package's entry points that another package will call).
- You re-read your whole diff once as a hostile reviewer: panics, overflows, unbounded allocation or loops on malicious input, quadratic behaviour the C code does not have, leftover debugging, needless comments.
- Work is committed on your worktree's branch (`git add src/webp && git commit`; plain descriptive message, no attribution lines, do not push).
- Final report (it is all the coordinator sees): the branch/worktree path and commit, module list with line counts, the interface other packages call, exact harness results (commands and counts), benchmark numbers vs. the reference, every deliberate deviation from the C code, every quirk or bug of libwebp you noticed and kept (or could not keep), anything left undone.

## Addendum: benchmarking profile

The harness's `release` profile has overflow checks and debug assertions on, which is right for testing and wrong for
timing. For `bench-*` use the `perf` profile (copy the `[profile.perf]` section from `/root/ref/harness/Cargo.toml` into
your harness copy if it lacks it):
`RUSTFLAGS="-Ctarget-cpu=nehalem" cargo build --profile perf && ./target/perf/webp-diff bench-...`
Every x64 build of Bun targets nehalem (SSE4.2, no AVX), so that is the number that counts.
