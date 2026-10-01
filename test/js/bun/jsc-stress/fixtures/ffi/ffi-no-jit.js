//@ runNoJIT
//@ requireOptions("--useDollarVM=1")

// bun:ffi requires the JIT (SPEC section 0.1): with --useJIT=false the
// creation of JSFFIFunction / JSFFICallback must throw a TypeError with the
// message "bun:ffi requires the JIT", and nothing must crash. (When the
// harness runs this file with the JIT enabled anyway, creation must succeed.)

function expectRequiresJIT(fn, label) {
    let error = null;
    try {
        fn();
    } catch (e) {
        error = e;
    }
    if (error === null)
        throw new Error(label + ": expected a TypeError, nothing thrown");
    if (!(error instanceof TypeError))
        throw new Error(label + ": expected a TypeError, got " + error);
    if (String(error.message).indexOf("bun:ffi requires the JIT") === -1)
        throw new Error(label + ": unexpected message: " + error.message);
}

const signature = { args: ["i32", "i32"], returns: "i32" };
const callbackSignature = { args: ["i32"], returns: "i32" };
const target = $vm.ffiFixture("ffi_add_i32");

if ($vm.useJIT()) {
    // The harness may also run this file in JIT configurations: then creation
    // works and the function is callable.
    const add = $vm.ffiFunction(signature, target, "ffi_add_i32");
    if (add(40, 2) !== 42)
        throw new Error("JIT configuration: ffi_add_i32(40, 2) !== 42");
    const cb = $vm.ffiCallback(callbackSignature, x => x + 1);
    if (typeof cb.ptr !== "number")
        throw new Error("JIT configuration: callback .ptr should be a number");
} else {
    for (let i = 0; i < 3; ++i) {
        expectRequiresJIT(() => $vm.ffiFunction(signature, target, "ffi_add_i32"), "$vm.ffiFunction without JIT");
        expectRequiresJIT(() => $vm.ffiCallback(callbackSignature, x => x + 1), "$vm.ffiCallback without JIT");
    }
    // Signature-only APIs and fixtures still work without the JIT.
    if ($vm.ffiSignatureString(signature) !== "i32(i32,i32)")
        throw new Error("ffiSignatureString should work without the JIT: " + $vm.ffiSignatureString(signature));
    if (typeof target !== "number" || !(target > 0))
        throw new Error("ffiFixture should return a pointer without the JIT: " + target);
    if (!Array.isArray($vm.ffiFixtures()) || $vm.ffiFixtures().length < 90)
        throw new Error("ffiFixtures should work without the JIT");
}
