#!/bin/bash
# Dead code in the lossy decoder, whatever the crate allows for now.
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")/../.."
grep -n "dead_code" src/webp/lib.rs
cargo fmt -p bun_webp --check > /dev/null && echo "fmt clean"
touch src/webp/lib.rs
cargo clippy -p bun_webp -- --force-warn dead_code --force-warn unused 2>&1 | grep -E "^ *--> src/webp" | sort | uniq -c | sort -rn | head -60
echo END
