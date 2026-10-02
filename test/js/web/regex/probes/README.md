# Regex JIT probe scripts

Reproducers, differential tables, and diagnostic drivers written while
verifying the JSC Yarr lookbehind / unicode work. They are raw material for
permanent tests: each `*.js` table prints one canonical line per case so its
output can be diffed across engines (`jsc --useRegExpJIT=true|false`, node,
stock bun). Most define `out`/`print` shims so the same file runs under both
the jsc shell and node.

Highest-value tables (fold into regressions.mjs / the .test.ts suites):
- `staged.js`   -- 108-case corpus: BOL over-match family, optional-anchor
                   family, unicode lookbehind literals/classes/backrefs/groups,
                   nested assertions, sticky/global iteration.
- `two.js`, `pad.js`, `d.js`, `need.js`, `cls.js`, `eq.js`, `land.js`
                -- astral-first-alternative tables that found the
                   firstCharacterAdditionalReadSize discipline bug and the
                   still-open class-first equal-min over-advance (see below).
- `fold.js`     -- /iu Deseret case-fold and astral-class lookbehind cases.
- `nest.js`     -- three-deep nested assertions with counted terms (found the
                   renumbering crash).
- `alt.js`, `bm.js` -- astral alternation / Boyer-Moore controls (all engines
                   agree; keep as guards).
- `mid.js`      -- known /v mid-surrogate-pair divergence (JSC != V8, both JSC
                   tiers agree; pre-existing shared-layer).

Drivers: `run-jsc.mjs` + `soak-jsc.sh` (generated soak: node oracle vs jsc
per seed, file transport, 300 s watchdog); `one-case.mjs` (re-execute one
generated case by SEED/IDX for three-engine classification); `find-crash.mjs`
(announce-before-execute, so a crash names its case).

Session notes: `STAGE-D-DESIGN.md` (design + the bugs found and fixed).

## Open item recorded here
Class-first equal-minimum alternative over-advance (pre-existing upstream JSC,
JIT-only; interpreter and V8 correct): `/😀|[qz]a/u.exec("-😀")` -> JIT `null`,
correct `[1,"😀"]`. Requires: astral first alternative + a following alternative
of EQUAL minimum size whose (post-optimizeAlternative) leading terms include a
non-inverted class; inverted classes and unequal minima are unaffected. See
`eq.js` for the full boundary table.
