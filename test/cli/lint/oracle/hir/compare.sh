#!/bin/bash
# The parser that writes the HIR directly (src/sema/parser) against the pipeline that recovers from errors (src/js_parser/sema).
#
#   BUN_HIR=<bun-hir> compare.sh <file, directory or .jsonl>..
#
# `bun-hir` is the binary of src/sema/parser/standalone (`cargo build --release -p bun_sema_parser_standalone`).
# A .jsonl has one text per line: {"id", "filename", "code", "sourceType", "parser"}.
#
# 1. Every text is parsed by both, in each dialect, as a module and as a script, and the two HIRs are walked together: every field
#    of every node, all side lists, the diagnostics. The direct parser is also run with the file's own atoms.
# 2. Every file is damaged in ROUNDS ways: what the direct parser then accepts has to be valid for the other, with the same HIR.
#
# It fails if anything is DIFFERENT, ACCEPTED (the other parser reports a syntax error and the direct one does not) or WRONG, or if
# the process dies. Texts that are valid and REFUSED go through the other pipeline: they are counted, and the goal is 0.
set -u
ulimit -c 0
ulimit -v "${MEMORY_KB:-8000000}"
hir=${BUN_HIR:?the path of bun-hir}
jobs=${JOBS:-8}
keep=$(mktemp -d)
trap 'rm -rf "$keep"' EXIT
failed=0
for dialect in ${DIALECTS:-tsc estree espree babel}; do
  for goal in "" --script; do
    summary=$("$hir" compare "$@" --dialect="$dialect" $goal --jobs="$jobs" --show=5) || { echo "$dialect $goal: bun-hir died"; failed=1; continue; }
    line=$(grep "valid for the reference" <<< "$summary")
    echo "$dialect${goal:+ script}: $line"
    grep -q " 0 different, " <<< "$line" && grep -q " 0 accepted" <<< "$line" || { grep -A1 -E "^(DIFFERENT|ACCEPTED)" <<< "$summary"; failed=1; }
  done
done
directories=()
for path in "$@"; do [[ $path == *.jsonl ]] || directories+=("$path"); done
if [ ${#directories[@]} -gt 0 ] && [ "${ROUNDS:-5}" != 0 ]; then
  for dialect in tsc espree; do
    summary=$(timeout "${TIMEOUT:-1800}" "$hir" fuzz "${directories[@]}" --rounds="${ROUNDS:-5}" --seed="${SEED:-1}" --jobs="$jobs" --keep="$keep" --dialect="$dialect") ||
      { echo "fuzz $dialect: bun-hir died or hung on one of:"; ls "$keep"/current-* 2> /dev/null; failed=1; continue; }
    echo "fuzz $dialect: $(tail -1 <<< "$summary")"
    grep -q " 0 wrong" <<< "$summary" || { grep "^WRONG" <<< "$summary" | head; failed=1; }
  done
fi
exit $failed
