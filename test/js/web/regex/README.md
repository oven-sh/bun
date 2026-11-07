# RegExp test surface

bun ships JavaScriptCore's Yarr regex engine; these suites test its
observable behaviour and cross-check it against V8 (node) as an oracle.
Everything here runs unchanged under both `bun` and `node`.

## Layers

| Layer | File | What it does |
|---|---|---|
| Pinned regressions | `regex-regressions.test.ts` + `differential/regressions.mjs` | Minimal reproducers for every engine divergence ever found, with spec-correct expectations (mechanically verified against node). Current bun/JSC bugs live in `knownBunFailures` with their present wrong output asserted, so an engine fix flips them to an unexpected pass. |
| Neighborhoods | `regex-neighbors.test.ts` + `differential/neighbors.generated.mjs` | Variants derived around every pinned case (flags, quantifiers, anchors, captures, inputs) with node-recorded expectations. |
| Semantics | `regex-lookbehind-alternation.test.ts` | Focused, hand-written coverage of lookbehind and alternation semantics; each assertion bracketed by nearest-neighbor variants; all cross-checked against node. |
| Error parity | `regex-syntax-errors.test.ts` + `differential/error-corpus.mjs` | 148 borderline/invalid patterns must be accepted or rejected exactly like V8, with matching normalized source/flags. |
| Live differential fuzzing | `regex-differential.test.ts` + `differential/{generator,execute,run}.mjs` | Generates fresh random regexes each run over the full syntax surface and compares every observable behaviour byte-for-byte against a live node oracle. |
| V8 corpus | `test/js/third_party/v8-regexp/` | V8's own mjsunit RegExp tests, run under bun and (as oracle) under node. |

## Running

    bun test test/js/web/regex/                          # everything above
    bun test test/js/third_party/v8-regexp/                # the V8 corpus
    node test/js/third_party/v8-regexp/run-under-node.mjs  # V8 corpus under node

Deep local soak of the fuzzer (thousands of cases):

    REGEX_DIFF_COUNT=20000 bun test test/js/web/regex/regex-differential.test.ts

The fuzzer prints its seed on failure. Reproduce a single divergent case:

    node test/js/web/regex/differential/run.mjs --seed <S> --index <I>
    bun  test/js/web/regex/differential/run.mjs --seed <S> --index <I> --capabilities '<header line>'

`--capabilities` pins the syntax feature set (probed from the oracle) so both
engines regenerate the identical case stream even when one supports newer
syntax than the other (see `differential/capabilities.mjs`).

## When the fuzzer finds a divergence

1. Reduce it to the smallest pattern + input (the `run.mjs --index` output
   shows the exact case and which operation diverged).
2. Determine which engine is right (spec first; node is usually correct but
   not always -- see `test/js/third_party/v8-regexp/KNOWN-DIVERGENCES.md` for
   cases in both directions).
3. Add the minimal reproducer to `differential/regressions.mjs` with the
   correct `expected`, and re-run
   `node differential/check-regressions-under-node.mjs` to confirm the
   expectation matches V8 (or note in a comment why V8 is wrong).
4. If bun currently fails it, add it under `knownBunFailures` (recording bun's
   present output) and file the engine bug; when fixed, move it up to `cases`.
5. Regenerate the neighborhoods: `node differential/expand-neighbors.mjs >
   differential/neighbors.generated.mjs`.

## Verifying hand-written expectations

Hand-written regex expectations are easy to get wrong. Any suite here that is
pure computation can be executed under node to cross-check it:

    node test/js/web/regex/differential/run-buntest-under-node.mjs test/js/web/regex/regex-lookbehind-alternation.test.ts
