// @bun
//@ requireOptions("--useConcurrentJIT=0", "--validateGraph=1")

// Second fuzzer-found shape of the same bug as
// for-using-dispose-call-live-catch-locals-ftl-validation.js: here the dispose
// method is a trivial closure that gets inlined into the dispose call, which
// still leaves the synthesized catch's try range ending in the middle of the
// block, so the "body threw" flag it reads was likewise not flushed when the
// block crossed into the user's try/catch. The body has to throw on some calls
// so that the "body threw" path is live in the compiled graph. The FTL compile
// of run() used to fail OSR availability validation on that flag.

function run(bodyShouldThrow) {
    try {
        using r = { [Symbol.dispose]() { } };
        if (bodyShouldThrow)
            throw 0;
    } catch (e) {
        return e;
    }
    return null;
}

for (let i = 0; i < 20000; ++i) {
    const result = run(i & 1);
    if (result !== ((i & 1) ? 0 : null))
        throw new Error(`Unexpected result ${result} on iteration ${i}`);
}
