// @bun
//@ runDefault("--useConcurrentJIT=false", "--validateGraphAtEachPhase=true")
// From WebKit/JSTests/stress/array-iterator-fast-entries-double-array-fixup-exit-ok.js
// (added by WebKit/WebKit@ae69ef2312c0, "entries" ArrayIterator should emit
// ExitOK before NewArray).
//
// The DFG fast path for iterating `doubleArray.entries()` emits GetByVal (which
// clobbers exit state) followed by NewArray([index, value]) inside a single
// bytecode origin. Without an ExitOK between them, the NewArray is exit-invalid,
// so FixupPhase inserted the ValueRep that re-boxes the double element at the
// last exit-OK node: one slot before the GetByVal that defines its operand. The
// resulting use-before-def graph crashed VirtualRegisterAllocationPhase on the
// JIT worker thread (Vector<unsigned, 64, CrashOnOverflow> abort).
//
// --validateGraphAtEachPhase makes a reintroduction fail deterministically right
// after fixup; without it the crash is probabilistic at register allocation.

function inner(iterator) {
    for (const item of iterator) { }
}

function driver() {
    // Double (copy-on-write) storage: 4294967295 does not fit in Int32.
    const values = [268435456, 4294967295, 268435456, 268435456, 268435456];
    const iterator = values.entries();
    for (let i = 0; i < 100; ++i)
        inner(iterator);
}

for (let i = 0; i < testLoopCount; ++i)
    driver();
