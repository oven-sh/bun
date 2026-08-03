# Cross-crate dead-code analysis (hawk)

[hawk](https://github.com/astral-sh/hawk) finds `pub` items no shipped root
reaches (`hawk::dead_public`) and over-visible declarations
(`hawk::unnecessary_public`, applied with `--fix`) across the whole Rust
workspace — the cross-crate cases rustc's per-crate `dead_code` cannot see.

The analysis config lives at the repo root: `hawk.toml` (release profile ×
the 11 shipped targets, plus overrides for enum variants whose discriminants
are external code tables).

Hawk needs a `bin` product to root the analysis, but Bun's product crate
(`src/bun_bin`) ships as a `staticlib` linked by the C++ build. Adding an
`rlib`/`[[bin]]` permanently would disable fat LTO on the shipped staticlib,
so the root is applied only for the duration of a run:

```sh
git apply tools/hawk/analysis-root.patch      # adds rlib + a throwaway [[bin]] to src/bun_bin
printf 'fn main() {}\n' > src/bun_bin/hawk_root.rs
export BUN_CODEGEN_DIR="$PWD/build/debug/codegen"   # run `bun bd --configure-only` + codegen first
cargo hawk check --jobs "$(nproc)" --output-format=json > hawk-report.json
git checkout -- src/bun_bin/Cargo.toml && rm -f src/bun_bin/hawk_root.rs   # revert the scaffolding
```

The `#[no_mangle]` exports the C++ side calls are Hawk's real reachability
roots; the empty `fn main() {}` is sufficient because Hawk treats every
`#[no_mangle]` item as a root. `// HOST_EXPORT(...)`-marked functions are
kept via a `[[root-marker]]` (they are scraped by
`src/codegen/generate-host-exports.ts` and must stay `pub fn`).
