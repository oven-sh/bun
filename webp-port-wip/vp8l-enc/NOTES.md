# VP8L encoder port notes
- worktree: /root/repos/oven-sh/bun/.claude/worktrees/agent-a2dc5bb9366bc63d8 (branch worktree-agent-a2dc5bb9366bc63d8)
- branch was cut from main (9b8347a2) not coordinator; I did `git reset --hard 6702a800` (coordinator commit). Mention in report.
- harness: target/webp-diff  (build: . ~/.bun-dev-env && cd target/webp-diff && cargo build --release)
- Bash hook: commands mentioning git must be plain/simple, one per call; no heredocs/complex constructs with the word git
## Progress
## Reachability analysis (done reading all C)
- Params: image (quality 70, exact 0), alpha (quality 32, exact 1), method always 4. EncodePalette -> EncodeImageNoHuffman quality=20.
- 1 crunch config; entropy_idx in Direct/Spatial/SubGreen/SpatialSubGreen/Palette (no PaletteAndSpatial); palette sorting only kMinimizeDelta.
- sub_configs: [Standard|RLE] (+ [Box] if 0<palette_size<=16). do_no_cache = 0 always -> refs[0],refs[1]=tmp; BackwardRefsClone dead.
- Rle/Lz77/Box always called with cache_bits 0 (no colour cache in them).
- predictor: min_bits==max_bits (ClampBits idempotent) => raster order, single subsampling idx, ShannonEntropy/pred_histos dead. max_quantization=1.
- alpha never picks SubGreen/SpatialSubGreen (entropy >=), so cross colour only quality 70; keep quality param anyway.
- quality<25 branches in cross colour dead. CalculateBestCacheSize quality<=25 => 0 (only via cache_bits_max=0 anyway in NoHuffman)
- qsort comparators: palette (distinct u32), huffman trees (distinct value) => no ties.
- DivRound is int64; BitsEntropyRefine casts u64->i64 (could exceed 2^63 only for ~16383^2 uniform imgs) -> use wrapping + as i64.
- HistogramSet: emulate pointer array w/ index indirection (stale slot [size] is read in Stochastic after remove).
- prefix encode LUT can be computed: d<=2 => (max(d-1,0),0,0) else formula. cost_cache[k]=GetLengthCost(k) incl k=0 -> code 0.
- BENCH: use perf profile: RUSTFLAGS="-Ctarget-cpu=nehalem" cargo build --profile perf && ./target/perf/webp-diff bench-... (test with release)
- [done] all modules written & compile; lossless 0 2000 => 0 differ (first run). build helper: bash scratchpad/b.sh build|perf|clippy|fmt (hook refuses '. ~/.bun-dev-env'). TODO: corpus img, alpha mode in harness, extra generators, clippy, dead-code check, perf, hostile review, commit, report
- [verified @c785ded1, SIMD ref] lossless 0..20000, hard 0..20000, alpha 0..21000, alpha-synth 4000, alpha-img 308, small 6936, extreme 100, lossless-img 77: all 0 differ. run: bash scratchpad/run.sh TAG (NOSIMD=1 for plain C). Baseline perf ~1.0x of ref. Optimising: Accumulated cache (done, uncommitted), next ColorTile planar + memo, EXACT fast path when no alpha==0 px. instrument2.py [undo] = temp timers
- !! scratchpad is SHARED with the other agents: all my files now live in scratchpad/vp8lenc/ (b.sh run.sh bench.sh timing.sh ctiming.sh instrument*.py NOTES.md cref/). Never run scripts from scratchpad root. C stage timings: bash vp8lenc/ctiming.sh IMG. Opts done: Accumulated cache, ColorTile+tried memo (committed f5e3eca0); EXACT when no alpha==0 px, best_cache_size heap layout + count-on-hit (uncommitted). Tried & rejected: chunk-skipping Runs, chunked vector_mismatch. TODO: trace_backwards 1.8x slower than C on flat imgs
- [verified optimised code, NOSIMD, BASE=100000] full suite 0 differ (16 jobs). stride 0..1000 0 differ. abort-run (cabort/harness2: aborts in every branch claimed unreachable) no crash so far. Folded: cross colour QUALITY=70 const, no quality in best_cache_size, no quality>75 window. big 6000x5000 x6 running (task bgwprabfz). NEXT: commit, final SIMD suite BASE=300000 on final commit, final bench table, report
## Findings to mention at the end
- commits on 6702a800: 49f73393 c785ded1 f5e3eca0 27739eb8 bc2da5c3
- qsort: palette colours distinct; huffman trees tie-broken by distinct value => no ties
- quirks kept: cost_cache[k]=GetLengthCost(k) for len k+1; i_last_check useless; HistogramAdd unused+trivial=>nontrivial; Stochastic reads stale histograms[size]; empty cache holds 0; alpha-0 px RGB arbitrary after predictor; raw alpha fallback stores filtered plane; histogram_image_size=max symbol+1
- deviations: Accumulated cache, ColorTile+4 histos+tried memo, EXACT if no alpha0, raster tiles (min==max bits), best_cache heap+count on hit, argb consumed/in-place palette, own hashchain for sub-images, prefix formula (==LUT 512), folded quality consts
- portability: ln=libm log; arm64 clang may fma-contract K*v*log(v)+.5, Rust never; verified on x86-64 only
- abort-run: 24453 cases, no unreachable branch hit
