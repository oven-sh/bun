# Concurrent-GC slot corruption stress harness (BUN-2V5X / BUN-2V7T)

Investigative tooling for the Windows-only crash where
`SlotVisitor::appendValuesHidden` reads a garbage `JSValue` from an object's
slot array and faults at `MarkedBlock::aboutToMark` →
`WTF::Dependency::loadAndFence` (fault address pattern `(garbage & ~0x3FFF) + 0x20`).

Sentry: BUN-2V5X (loadAndFence, ~2.2k events) and BUN-2V7T
(`MethodTable::visitChildren`, ~4.3k events). 100% Windows, ~90% baseline
build, ~95% `StandaloneExecutable`, strongly correlated with
`abort_signal`/`fetch`/`spawn`/`yaml_parse` feature tags.

## Files

- `gc-stress.js` — round 1 workload: wide object literals, nested closures,
  array literals/spreads, grown arrays, AbortController + fetch + Bun.spawn
  churn. Covers `JSFinalObject` / `JSLexicalEnvironment` / `JSCellButterfly` /
  `JSObjectWithButterfly` (the four caller shapes in the crash stacks).
- `gc-stress-yaml.js` — round 2: adds `Bun.YAML.parse` / `JSON.parse` on deep
  nested documents (native object-graph builders) alongside the abort/fetch
  loops. Chosen because `yaml_parse=True` is present on 64% of crashers.
- `run-stress.ps1` — PowerShell driver: runs N iterations of a workload with
  `BUN_JSC_collectContinuously=1`, `collectContinuouslyPeriodMS=0.3`,
  `numberOfGCMarkers=8`, `slowPathAllocsBetweenGCs=97`, `forceRAMSize=256M`,
  classifies exit codes, dumps stderr on segfault.

## Usage (Windows)

```powershell
pwsh -File run-stress.ps1 -Iterations 40 -Seconds 60 -Script .\gc-stress-yaml.js
# optional: -ExtraJsc 'verifyGC=1;verifyHeap=1;useZombieMode=1;scribbleFreeCells=1'
```

## Results (bun 1.4.0 canary b0925d7fb, Windows Server 2019 x64 baseline)

| round | workload | JSC options | runs × sec | result |
|---|---|---|---|---|
| 1 | gc-stress.js | collectContinuously=0.3ms, forceRAMSize=256M | 40 × 45s | 0/40 |
| 2 | gc-stress-yaml.js | + slowPathAllocsBetweenGCs=97 | 30 × 60s | 0/30 |
| 3 | gc-stress-yaml.js | + verifyGC + verifyHeap + useZombieMode + scribbleFreeCells | 15 × 90s | 0/15 |

Roughly 85 minutes, ~17M GC cycles under `collectContinuously`, zero crashes
and zero heap-verification failures.

## What this rules out

- JSC's concurrent marking is sound for the standard allocation paths
  exercised here (object literals, closures, array literals, grown arrays,
  `constructEmptyArray` + `putDirectIndex`).
- Bun's `create_empty_array(len)` → recurse → `put_index` pattern
  (`Bun.YAML.parse`, JSONC/JSON5/TOML, napi) is safe:
  `JSArray::tryCreate` → `Butterfly::clearRange` memsets the butterfly before
  `createWithButterfly` publishes it.
- Audited every `tryCreateUninitializedRestricted` caller in Bun bindings
  (JSFetchHeaders, JSDOMFormData, JSURLSearchParams, SerializedScriptValue,
  NodeHTTP, JSSQLStatement, BunProcess, JSMockFunction, bindings.cpp helpers):
  all fill every slot with non-allocating stores under an
  `ObjectInitializationScope` before the array becomes heap-reachable.

## What this does not cover

- Native addons (`process_dlopen=True` on 33% of crashers,
  `napi_module_register=True` on 22%). An addon writing past a TypedArray
  backing store or into a napi-wrapped object's storage would produce exactly
  this crash shape and would not be caught here.
- Worker VM teardown interacting with main-VM GC (19% of crashers spawned
  workers).
- The specific Claude Code workload (largest single population of crashers).
- Very long-running processes; field rate is roughly 0.01%/user-hour so a
  multi-hour soak may be required even with amplification.
