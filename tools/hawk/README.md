# Cross-crate dead-code analysis (hawk)

[hawk](https://github.com/astral-sh/hawk) finds `pub` items no shipped root
reaches (`hawk::dead_public`) and over-visible declarations
(`hawk::unnecessary_public`, applied with `--fix`) across the whole Rust
workspace — the cross-crate cases rustc's per-crate `dead_code` cannot see.

The analysis config lives at the repo root: `hawk.toml` (release profile ×
the 11 shipped targets, plus overrides for enum variants whose discriminants
are external code tables).

## Running it

```sh
bun scripts/build.ts --configure-only && ninja -C build/debug codegen clone-lolhtml
bun run rust:hawk install          # builds cargo-hawk from the oven-sh/hawk rev pinned in scripts/rust-hawk.ts
bun run rust:hawk                  # all current findings (main has thousands; see below)
bun run rust:hawk --only dead-public --output-format=json > hawk-report.json
```

A full run compiles the workspace for all 11 targets, roughly 20 minutes on
16 cores (the critical path is `bun_runtime`, so more cores do not help much)
and about 4 GB of target dir.

## CI

`.github/workflows/hawk.yml` runs on PRs that touch Rust. `main` is not
hawk-clean (#36184 narrowed visibility but left the dead-public deletions for
later), so the job analyzes both the base commit and the PR and fails only on
findings the PR introduces, listing them as inline annotations and in the job
summary. The comparison (`bun run rust:hawk diff base.json head.json`) keys
findings on lint + crate + item path + item kind, so unrelated line shifts do
not count as new, but moving or renaming an already-flagged item does.

When the job fails: delete the item, narrow its visibility, or, if it is dead
on purpose (a code table, or an API a stacked follow-up PR is about to use),
add an `[[override]]` to `hawk.toml` with a `reason`. Prefer
`level = "expect"`: once the item gains a user, hawk reports
`hawk::unfulfilled_expectation`, so the stale override gets removed too. The
job is advisory, not a required check.

Upstream hawk lacks the multi-target analysis and `[[root-marker]]` support
this config uses, so the script builds from the `bun` branch of
[oven-sh/hawk](https://github.com/oven-sh/hawk), against the workspace's
pinned nightly (the driver links rustc internals and has to match the
compiler that builds the workspace, so a toolchain bump means reinstalling).

Hawk needs a `bin` product to root the analysis, but Bun's product crate
(`src/bun_bin`) ships as a `staticlib` linked by the C++ build. Adding an
`rlib`/`[[bin]]` permanently would disable fat LTO on the shipped staticlib,
so `scripts/rust-hawk.ts` applies `analysis-root.patch` (rlib + a throwaway
`[[bin]]` in `src/bun_bin`) plus an empty `hawk_root.rs` for the duration of
the run and reverts them afterwards.

The `#[no_mangle]` exports the C++ side calls are Hawk's real reachability
roots; the empty `fn main() {}` is sufficient because Hawk treats every
`#[no_mangle]` item as a root. `// HOST_EXPORT(...)`-marked functions are
kept via a `[[root-marker]]` (they are scraped by
`src/codegen/generate-host-exports.ts` and must stay `pub fn`).
