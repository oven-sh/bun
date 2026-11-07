//@ requireOptions("--useDollarVM=1")

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const depth = () => $vm.ffiArenaDepth();

    if (depth() !== 0)
        throw new Error("arena depth should start at 0, got " + depth());

    const strlen = $vm.ffiFunction({ args: ["cstring"], returns: "u64" }, fixture("ffi_strlen"), "ffi_strlen");
    for (let i = 0; i < 2e4; ++i) {
        strlen("call " + (i & 7));
        if (depth() !== 0)
            throw new Error("arena depth leaked after a normal call at iteration " + i + ": " + depth());
    }

    let calls = 0;
    const callback = $vm.ffiCallback({ args: [], returns: "cstring" }, () => {
        ++calls;
        throw new Error("thrown from callback");
    });
    const callThrough = $vm.ffiFunction({ args: ["ptr"], returns: "cstring" }, fixture("ffi_call_cb_ret_cstring"), "ffi_call_cb_ret_cstring");
    for (let i = 0; i < 2e4; ++i) {
        let threw = false;
        try {
            callThrough(callback.ptr);
        } catch (e) {
            threw = e instanceof Error && e.message === "thrown from callback";
        }
        if (!threw)
            throw new Error("expected the callback exception to propagate at iteration " + i);
        if (depth() !== 0)
            throw new Error("arena depth leaked after a throwing cstring call at iteration " + i + ": " + depth());
    }
    callback.close();
    if (calls !== 2e4)
        throw new Error("callback ran " + calls + " times, expected 20000");
}

if ($vm.useJIT())
    main();
