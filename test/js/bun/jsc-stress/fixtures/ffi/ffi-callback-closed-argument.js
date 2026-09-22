//@ requireOptions("--useDollarVM=1", "--useConcurrentJIT=0", "--jitPolicyScale=0", "--useExecutableAllocationFuzz=false")

// A closed JSFFICallback passed where a pointer is expected throws a TypeError: as a "function",
// "ptr" or "cstring" argument on the host path and through DFG / FTL CallFFI code, and as the return
// value of another callback. close() unroots the cell, and the entrypoint is freed with the cell, so
// a native callee that kept the pointer would call freed code. `ptr` is null after close() for the
// same reason, and passing the object must not get around that. A path that was missed shows up here
// as a call that returns a value instead of throwing.

function shouldBe(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": expected " + String(expected) + " but got " + String(actual));
}

function shouldThrowClosed(fn, what) {
    let error = null;
    let result;
    try {
        result = fn();
    } catch (e) {
        error = e;
    }
    if (!error)
        throw new Error(what + ": the native callee got the closed callback and returned " + String(result));
    if (!(error instanceof TypeError) || error.message !== "bun:ffi: cannot pass a JSCallback as a pointer because it was closed")
        throw new Error(what + ": wrong error: " + error);
}

function bind(name, args, returns) {
    return $vm.ffiFunction({ args, returns }, $vm.ffiFixture(name), name);
}

function testColdCall() {
    const asFunction = bind("ffi_call_cb_i32", ["function", "i32"], "i32");
    const asPtr = bind("ffi_ptr_identity", ["ptr"], "ptr");
    const asCString = bind("ffi_ptr_identity", ["cstring"], "ptr");

    let runs = 0;
    const callback = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => {
        ++runs;
        return x + 1;
    });
    const address = callback.ptr;
    shouldBe(asFunction(callback, 1), 2, "open callback as a 'function' argument");
    shouldBe(asPtr(callback), address, "open callback as a 'ptr' argument");
    shouldBe(asCString(callback), address, "open callback as a 'cstring' argument");

    callback.close();
    shouldThrowClosed(() => asFunction(callback, 1), "closed callback as a 'function' argument");
    shouldThrowClosed(() => asPtr(callback), "closed callback as a 'ptr' argument");
    shouldThrowClosed(() => asCString(callback), "closed callback as a 'cstring' argument");
    shouldThrowClosed(() => asFunction.call(null, callback, 1), "Function.prototype.call");
    shouldThrowClosed(() => Reflect.apply(asFunction, null, [callback, 1]), "Reflect.apply");
    shouldBe(runs, 1, "runs of the closed callback");

    // Only the object is refused. A number is the caller's own to keep valid, and this one is:
    // the entry code lives as long as the cell, and `callback` is still referenced here.
    shouldBe(asFunction(address, 5), 6, "the address read before close()");
}

function testThreadsafeCallback() {
    const asPtr = bind("ffi_ptr_identity", ["ptr"], "ptr");
    const callback = $vm.ffiCallback({ args: [], returns: "void" }, () => { }, { threadsafe: true });
    shouldBe(asPtr(callback), callback.ptr, "open threadsafe callback as a 'ptr' argument");
    callback.close();
    shouldThrowClosed(() => asPtr(callback), "closed threadsafe callback as a 'ptr' argument");
}

function testCloseAfterTierUp() {
    const callCbI32 = bind("ffi_call_cb_i32", ["function", "i32"], "i32");
    let runs = 0;
    const victim = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => {
        ++runs;
        return x + 1;
    });
    const open = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => x + 1000);
    const before = $vm.ffiCompileCounts();

    function hot(callback, x) {
        return callCbI32(callback, x);
    }
    noInline(hot);

    for (let i = 0; i < 1e4; ++i)
        shouldBe(hot(victim, i), i + 1, "hot call " + i);

    // The check must be tested against compiled CallFFI code, not only against the host path.
    const after = $vm.ffiCompileCounts();
    if ($vm.useDFGJIT() && numberOfDFGCompiles(hot) > 0 && after.dfgCallFFI + after.ftlCallFFI === before.dfgCallFFI + before.ftlCallFFI)
        throw new Error("the hot caller was compiled without a CallFFI node");

    victim.close();
    for (let i = 0; i < 1e3; ++i) {
        shouldThrowClosed(() => hot(victim, i), "optimized caller, call " + i + " after close()");
        shouldBe(hot(open, i), i + 1000, "optimized caller, an open callback after call " + i);
    }
    shouldBe(runs, 1e4, "runs of the closed callback");
}

function testCloseInsideHotLoop() {
    const callCbI32 = bind("ffi_call_cb_i32", ["function", "i32"], "i32");
    const callback = $vm.ffiCallback({ args: ["i32"], returns: "i32" }, x => x + 1);
    const closeAt = 6000;
    let reached = 0;
    let thrown = 0;

    function loop() {
        for (let i = 0; i < 1e4; ++i) {
            if (i === closeAt)
                callback.close();
            try {
                callCbI32(callback, i);
                ++reached;
            } catch (e) {
                if (!(e instanceof TypeError))
                    throw e;
                ++thrown;
            }
        }
    }
    noInline(loop);
    loop();
    shouldBe(reached, closeAt, "calls that reached the native callee");
    shouldBe(thrown, 1e4 - closeAt, "calls that threw");
}

function testCallbackReturnValue() {
    const callCbRetPtr = bind("ffi_call_cb_ret_ptr", ["function"], "ptr");
    const returned = $vm.ffiCallback({ args: [], returns: "void" }, () => { });
    const returnsIt = $vm.ffiCallback({ args: [], returns: "ptr" }, () => returned);
    shouldBe(callCbRetPtr(returnsIt), returned.ptr, "a callback that returns an open callback");
    returned.close();
    shouldThrowClosed(() => callCbRetPtr(returnsIt), "a callback that returns a closed callback");
}

if ($vm.useJIT()) {
    testColdCall();
    testThreadsafeCallback();
    testCloseAfterTierUp();
    testCloseInsideHotLoop();
    testCallbackReturnValue();
}
