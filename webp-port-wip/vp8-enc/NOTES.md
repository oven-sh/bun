# VP8 encoder port notes (agent a4376b1e)
worktree: /root/repos/oven-sh/bun/.claude/worktrees/agent-a4376b1e3d6e35a81 (branch worktree-agent-a4376b1e3d6e35a81)
- worktree was created off origin main (9b8347a2) w/o src/webp; I reset --hard to 6702a800 (coordinator's commit). REPORT THIS.
- shell: cannot source ~/.bun-dev-env; use `export PATH="$HOME/.cargo/bin:$PATH"`. Bash guard refuses heredocs / $(...) / loops with vars. Use Write tool for files + run scripts:
  scratch dir S=/tmp/claude-1000/-root-repos-oven-sh-bun/8d005572-e973-552f-b171-042e1add37cd/scratchpad/vp8enc
  - `python3 rep.py pN.txt` (cd S first): search/replace patches (format: path\nold\n-----\nnew\n=====\n...)
  - `bash S/bench.sh N` perf-profile benchmark;  `WEBP_DIFF_VP8_ONLY=1 bash S/suite.sh [quick]` test-suite
  - gen_tables.py regenerates src/webp/vp8/enc/tables.rs (then cargo fmt)
- harness: <worktree>/target/webp-diff ; my extras in src/extra.rs (`webp-diff x ...`), perf profile added.
- src/webp/alpha/enc.rs stub TEMPORARILY returns Ok(Vec::new()) -> RESTORE (checkout) before the final commit.
## Status
- 2e59acc9 WIP commit: full port, 0 differ everywhere on first run (suite all green, retry path tested with cat tiled 8000x8000).
- baseline perf: 1.65-1.9x reference.
- background: 16383x16383 tiled cat q75 (expect Partition0Overflow both) -> S/huge.log
## Findings (reachability, config folded)
- use_tokens => VP8EncTokenLoop; FinalizeSkipProba never called => use_skip_proba=0, mb->skip/nb_skip dead.
- num_parts=1 => EmitPartitionsSize loop empty => PARTITION_OVERFLOW unreachable.
- VP8 chunk size INCLUDES pad byte (vp8_size += pad) => bitstream padded to even by me.
- sharpness 0 => VP8FilterStrengthFromDelta(0,d)=min(d,63). No table.
- retry loop: size_p0 > PARTITION0_SIZE_LIMIT => max_i4_header_bits >>= 1 and redo the pass (proba state persists!).
- top_derr enabled iff quality <= 98.
- token quirk: Cat5/Cat6 record stats at s+9 but proba idx base_id+10. KEPT.
- VP8LevelFixedCosts[9], [10] = 640: table lacks the cost of the last bit (true 851/952). Table copied verbatim.
- zthresh is redundant (QUANTDIV==0 <=> coeff<=zthresh): dropped.
- analysis: intra16/uv best modes dead (overwritten by Decimate); only alpha/uv_alpha matter. enc->alpha unused (jpeg emu only).
- uv_alpha sum is int in C, can overflow for ~1M MBs: wrapping_add.
- NaN quality passes WebPValidateConfig in C (UB later) -> I reject InvalidConfiguration. (deviation)
- kInvAlpha = (1<<19)/a computed by division. kAcTable2 = max(8, kAcTable*155/100) computed.
- gamma tables embedded (dumped by gamma.c; min distance to rounding boundary 0.0014 so libm-independent).
- TTransform(src) cached per MB (pure fn); TTransform passes swapped (weights symmetric).
- PreLoopInitialize uses base_quant=0 always (50 B/MB hint) - capacity only; I use tokens/8.
## Design
- block-major layout: Luma=[[u8;16];16], Chroma=[[[u8;16];4];2] instead of BPS cache.
- EncIterator separate from Encoder (owns nz/y_top/uv_top/top_derr).
