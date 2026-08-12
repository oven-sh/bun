// @bun
//@ requireOptions("--useConcurrentJIT=0")

// The disposal code emitted for a `using` block keeps "did the body throw" in a
// local that is only read by the synthesized catch handler wrapped around the
// dispose call. That handler has never run by the time the function is
// optimized, so nothing in the compiled code reads the local and it is only
// kept alive for the exception exit of the dispose call. The try range of the
// synthesized catch ends right at that call, inside the range of the enclosing
// handler, and DFG's LiveCatchVariablePreservationPhase used to switch to the
// outer handler's liveness before flushing for the inner one, dropping the
// local. The exit then restored it as undefined and the body's error was lost
// instead of being reported through a SuppressedError.

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`Expected ${expected} but got ${actual}`);
}

const state = { throwOnDispose: false };

// Distinct executables so the dispose call site becomes megamorphic and stays a
// real call instead of being inlined (inlining splits the block and hides the bug).
const resources = [];
for (let i = 0; i < 16; ++i) {
    resources.push({
        state,
        [Symbol.dispose]: new Function(`if (this.state.throwOnDispose) throw new Error("dispose ${i}");`),
    });
}

function run(resource, bodyShouldThrow) {
    try {
        {
            using r = resource;
            if (bodyShouldThrow)
                throw new Error("body");
        }
    } catch (e) {
        return e;
    }
    return null;
}

for (let i = 0; i < 20000; ++i) {
    const error = run(resources[i % resources.length], i & 1);
    shouldBe(error === null, !(i & 1));
}

state.throwOnDispose = true;
const error = run(resources[0], 1);
shouldBe(error instanceof SuppressedError, true);
shouldBe(error.error.message, "dispose 0");
shouldBe(error.suppressed.message, "body");
