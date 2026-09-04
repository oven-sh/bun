#!/bin/bash
# Soak: node oracle vs branch jsc, per seed via files.
D="$1"; OUT="$2"; FROM="$3"; TO="$4"; COUNT="$5"; JSC="$6"
mkdir -p "$OUT"
caps=$(node -e 'import("'"$D"'/capabilities.mjs").then(m=>console.log(JSON.stringify({capabilities:m.probeCapabilities()})))')
for seed in $(seq "$FROM" "$TO"); do
  perl -e 'alarm 240; exec @ARGV' node "$D/run.mjs" --seed "$seed" --count "$COUNT" --capabilities "$caps" --out "$OUT/o.jsonl" 2>"$OUT/o.err" || { echo "seed $seed: NODE-ERR/timeout"; continue; }
  perl -e 'alarm 300; exec @ARGV' "$JSC" -e "globalThis.SEED=$seed; globalThis.COUNT=$COUNT; globalThis.CAPS='$caps'" -m "$OUT/../run-jsc.mjs" > "$OUT/j.jsonl" 2>"$OUT/j.err" || { echo "seed $seed: JSC-ERR/timeout ($(head -c 80 $OUT/j.err))"; cp "$OUT/o.jsonl" "$OUT/oracle-$seed.jsonl"; continue; }
  if cmp -s "$OUT/o.jsonl" "$OUT/j.jsonl"; then echo "seed $seed: identical"
  else n=$(diff "$OUT/o.jsonl" "$OUT/j.jsonl" | grep -c '^<'); echo "seed $seed: DIVERGENT ($n case-lines)"; cp "$OUT/o.jsonl" "$OUT/oracle-$seed.jsonl"; cp "$OUT/j.jsonl" "$OUT/under-$seed.jsonl"; fi
done
