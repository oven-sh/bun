#!/bin/bash
# rustfmt + clippy on bun_webp, without the noise about the workspace manifest.
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")/../.."
cargo fmt -p bun_webp
cargo clippy -p bun_webp 2>&1 | grep -v "unused workspace\|Cargo.toml:435\|^ *|$\|435 |\|\^\^\^\^\^\^\^\^$\|unused_workspace_dependencies\|consider removing the workspace\|workspace (manifest)" | head -${1:-120}
