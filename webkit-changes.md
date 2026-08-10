# JSC/WTF/bmalloc changes: 3722912ff800 -> bbc000ae4f3d (upstream WebKit main)

**134 upstream commits** (no-merges) touching `Source/JavaScriptCore`, `Source/WTF`, `Source/bmalloc`, dated **2026-08-02 -> 2026-08-10**. Headline items: `Strong<>` root storage rewritten (**HandleSet/HandleBlock deleted, StrongSet/StrongBlock added**), a large **Wasm memory64/table64 hardening wave** capped by an **ArrayBuffer/Wasm::Memory sizing overhaul that raises `MAX_ARRAY_BUFFER_SIZE` from 1<<32 to 1<<34 (4 GB -> 16 GB)**, continued **ARMv7/32-bit JIT removal** (ARMv7Assembler.h deleted, `USE(BUILTIN_FRAME_ADDRESS)`/`USE(JSVALUE64_32)` macros removed), builtins metadata now **precomputed at build time by the generator script**, and several stage-3 proposals enabled (Iterator chunking/join, joint iteration, import defer, RegExp buffer boundaries). **No changes to `runtime/JSType.h`, `bytecode/BytecodeList.rb`, or `runtime/OptionsList.h`** (verified: empty diffs; `Options.cpp` only lost dead ARM32 DFG overrides).

## Embedder ABI/API-affecting changes

- Headers **deleted**: `heap/HandleSet.h`, `heap/HandleBlock.h`, `heap/HandleBlockInlines.h` (by `ff64aee116d4`), `assembler/ARMv7Assembler.h` (by `6010a9ea6ce6`). Headers **added**: `heap/StrongBlock.h`, `heap/StrongSet.h`, `wtf/Nonallocatable.h`.
- `Heap::handleSet()` is gone; replaced by `Heap::strongSet()` (`StrongSet m_strongSet` member, Heap layout change). `Strong<T>` now allocates slots via `StrongSet`; `Strong.h`/`StrongInlines.h` rewritten accordingly. Direct `HandleSet` references in embedders must be ported.
- 36403ca62849 / f6bc402b8344: WTF `StackBounds::currentThreadStackBounds()` made private to `Thread` (use `Thread::currentSingleton().stack()` or the now-exported `currentThreadStackBoundsInternal()`).
- 9f82586af24c: removed `using WTF::Task` from WTF (conflicted with Swift's `Task`).
- ac2afd10b8ac + 6010a9ea6ce6: `PlatformEnable.h`/`PlatformUse.h` macro removals: `ENABLE_YARR_JIT_ALL_PARENS_EXPRESSIONS`, `ENABLE_YARR_JIT_BACKREFERENCES(_FOR_16BIT_EXPRS)`, `ENABLE_YARR_JIT_UNICODE_EXPRESSIONS`, `ENABLE_YARR_JIT_REGEXP_TEST_INLINE` (now unconditional on 64-bit JIT targets), `WTF_CPU_ARM_VFP_*`.
- 2a8926009f45: **`USE_BUILTIN_FRAME_ADDRESS` removed**, now unconditional on JIT platforms; the macro disappears from `PlatformUse.h`, `CallFrame.h`, `FrameTracers.h`, `AssemblyHelpers.h`, etc.
- 2c2c1af35743: `MAX_ARRAY_BUFFER_SIZE` (`runtime/PageCount.h`) raised `1ull << 32` -> `1ull << 34` on 64-bit.
- `JavaScriptCore/API` essentially untouched; no JSType/bytecode/Options name changes, so cached-bytecode/option plumbing is unaffected.

## GC / Heap

- **ff64aee116d4: Introduce StrongBlock**, replaces HandleSet/HandleBlock with a libpas-style segregated-page design (bump allocation + intrusive free lists, block reclamation hysteresis) for `Strong<>` slots; more memory efficient and faster.
- 6bdb4f69e23b: faster VM teardown, `MarkedSpace::lastChanceToFinalize` uses new `StopAllocatingMode::ForGood` to skip maintenance bookkeeping.
- f641af0b8e47: **missing write barrier in `Array.prototype.unshift`** (GC correctness fix).
- bbab514b1010: `LazyJSValue::emit` leaked a `StringImpl` ref when finalization was skipped.

## ArrayBuffer / Wasm memory64 & table64 (largest group)

- **2c2c1af35743: Overhaul ArrayBuffer & Wasm::Memory sizing with memory64**: ArrayBuffer max 4 GB -> 16 GB (matches V8 and the wasm-js-api spec limit); per-address-type limits (4 GB memory32 / 16 GB memory64); memory64 max page count capped at 262,144; avoids GC under the `BufferMemoryHandle` lock; fixes crash growing shared memory64 past 4 GB.
- 099f93fe4993 / b8af849be6f0 / 707048fdabb7: memory64/table64 JS API fixes; `Memory.prototype.type()` reports current size.
- Parsing/validation: d02c68d04f96, 40d37f36527f, aa8167a2feb9, 2e8a96a8c585, 64153f963497, de45b9be42db.
- Truncation fixes: b91045c99b1b, e942b93cdaa0, 02cdfb795a84, 0cc69e2993f4.
- JIT/runtime: d6d09268899b (force bounds-checking for memory64 in BBQ), 102fd6db184d, d319ee7c278e, 72928a517633, b1b0566f244e, 3c9a7dc13ae5.
- Crash fixes: bfe5073f4c99 (`updateCachedMemories()` on partially-linked instance), f771c5060cd7 (FrameTracer in `ref_func`/`table_get`/`array_init_elem`).
- Wasm-GC: 3f0a357ab034, 13ada10535a4 (avoid dictionary/ArrayStorage transitions on Wasm GC objects).
- 3e351c7849f3: SerializedScriptValue carries the memory64 flag for `WebAssembly.Memory`.

## Temporal / Intl

- 99473681ff5e: implement **intl-era-monthcode** proposal (Temporal + Intl eras).
- Spec-conformance rework: 399973c04a04, 4f049dc9046e (fixes monthCode TypeError regression), 89c1884e15a9, 22a13eb9ee2f (time zone identifier parsing via spec parse records; renames `ISO8601::TimeZoneRecord` -> `ISOStringTimeZoneParseRecord`), 6fd438a4aef2 (DST gap resolution epoch range checks), b48f01b7f1b1 (constructor `newTarget.prototype` ordering; unified CreateTemporalX helpers).
- Perf: e07ecf4c4a07 (one-pass monthCode search), 8776c95a1b0a (wider time zone cache).
- Intl: b2ec9a4586ee, 9ef04dabf52d, 7d0200e4e6ed (stale `String#localeCompare` collator cache), 33a5272cf9ac (cache collator for `localeCompare` with a string locale, big perf win).

## YARR / RegExp

- 2f66f5ed23f9: **RegExp Buffer Boundaries proposal** (`\A`, `\z`, `\Z`); 37f4628ab5fe reuses anchoring optimizations for them.
- Correctness: 7b5e7da783f5 (`\P{...}` after v-mode `&&`/`--`), 540f0965c655 (v-mode set ops stale character widths), 29d016fbd9f4 (lookbehind in `optimizeBOL`).
- Perf: bbc000ae4f3d (raw code units for surrogate-free BMP classes in unicode mode), 6a1ef9a1ef99, 81a11702ef82 (RegExp trim fast path survived DFG/FTL tier-up).

## DFG/FTL/JIT

- 0d25934d08a8: **share VM-independent JIT thunks globally across VMs** (memory + startup win for multi-VM embedders); c1b19d012809 splits eager vs lazy thunk creation.
- Optimizations: 465d5ab28c60 (inline `String#substring` in DFG/FTL), 2af38faaec70 (`Function#bind` strength reduction accepts method structures), fb299342a580, 74091f918bfc (new "Padding" Air opcode), deb0d2fa4be6 + 0270fd0a8d77 (JSBigInt add/sub/mul tightening).
- f40dcdd0730d + 76f57a9311b1: LLInt prologue zeroes new frames 16 bytes/iteration.
- Fixes: 91d96b29d6b2, c7ed9fcf7957.
- 32-bit/ARMv7 removal: 6010a9ea6ce6 (deletes `ARMv7Assembler.h`, strips `CPU(ARM)`/`CPU(ARM_THUMB2)` from assembler/JIT/B3/Air/wasm), bf1dab73b14d, 84f83abd45c9 (drops scratch-register params from `branchIfNumber` and friends), 55659d048725 (removes `USE(JSVALUE64_32)`), 9226ba78d93d (Int52 unconditional).

## Runtime / parser / startup performance

- 81d660ceeb2e: **builtin executable metadata computed in the Python builtins generator at build time** instead of at VM launch (shaves VM startup).
- 13dc8fa6e3d5: reserve initial capacity for AtomStringTable and `BuiltinNames` private name set.
- 6380373fc6a1 + a011564b98ab: comparator-less `Array#sort` rewritten as in-place counting/radix sort (follow-up restores stability).
- 01ea2a8eb955: `String#split` no longer atomizes results for non-atom subjects.
- 4f3ecec97431: `JSON.stringify` fast path accepts final objects with non-`Object` prototypes.
- Parser/lexer: 71c68f4b3b35, 8aa3307b46af, 5d6747ef60d4 (object-literal shorthand in arrow functions no longer forces materializing `arguments`).
- bff3814d76f7: Linux: stop re-reading `/proc/self/maps` when pushing checkpoint OSR side state.

## Language features enabled/updated

- 85e82ceefe1b enable **import defer** (+ cc673d7b23bf spec fixes).
- 793e36fb835e enable **Iterator chunking** (+ 547e1555ce4d), e9a62e6b4da5 enable **Iterator#join** (+ 7417386b7da1), 934bb002485a enable **joint iteration**.
- Note: these flips live in WebKit-level preference yamls, not `OptionsList.h`.

## Platform / build / WTF

- f880bc57ad50, 95940264e6c2, 19b7a8a4dbf6: GCC 15 fixes around `RefCountedWithInlineWeakPtr`; adds `wtf/Nonallocatable.h`.
- 559622a9eb50: **Windows**: RunLoop timer use-after-free fix (`FireTimerMessage` after timer destruction).
- ef6d9ba26b17 + 44bab332e0f1 (RT threads removal) were **reverted by 56baf6e01b3d** after JetStream3/Speedometer3 regressions (net zero).
- c17b54571809 / a24d4cb147c0 also reverted (net zero).
- bb345ab09ac5: WTF `SequesteredImmortalHeap` drops cached arena granules on memory pressure (Darwin).
