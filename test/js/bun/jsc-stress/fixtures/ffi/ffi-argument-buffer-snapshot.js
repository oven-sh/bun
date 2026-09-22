//@ requireOptions("--useDollarVM=1", "--useConcurrentJIT=0", "--jitPolicyScale=0")

// Marshalling one FFI argument list can run JS in the middle of it: an integer or a float argument
// coerces through valueOf / Symbol.toPrimitive, and an object passed for "ptr" has its "ptr"
// property read. That JS can detach, transfer, or resize a buffer another argument is read from,
// and then the address or the "buffer_length" of that argument describes memory that is gone. So
// every tier reads the addresses and the lengths after all of that JS has run: the pointer of a
// detached view is null, and the length behind a shrunk view is the new one. Each case runs cold
// (the C++ host path), hot through a monomorphic exact-arity caller (the IC stub, the DFG, the
// FTL) and pinned below the DFG, so no tier may disagree.

if (!$vm.useJIT())
    quit();

const fixture = name => $vm.ffiFixture(name);

// ffi_ptr_identity returns its first argument, so the call answers with the address the engine
// read for that argument: null once the view behind it is detached.
const pointerOfThenInt = $vm.ffiFunction({ args: ["ptr", "i32"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(ptr,i32)");
const pointerOfThenPointer = $vm.ffiFunction({ args: ["ptr", "ptr"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(ptr,ptr)");
// "cstring" takes a view like "ptr" does, and an untyped "cstring" argument also makes the DFG
// and the FTL bracket the call with the string arena.
const pointerOfCStringThenInt = $vm.ffiFunction({ args: ["cstring", "i32"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(cstring,i32)");
// The widest signature there is: the view first, the conversion that runs JS last.
const pointerOfThenManyInts = $vm.ffiFunction({ args: ["ptr", ...Array(31).fill("i32")], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(32 arguments)");
// ffi_add_u64 adds its two arguments, so one answer carries both marshalled slots.
const sumOfPointers = $vm.ffiFunction({ args: ["ptr", "ptr"], returns: "u64" }, fixture("ffi_add_u64"), "ffi_add_u64(ptr,ptr)");
// ffi_view_byte_length returns the length it was given. ffi_view_last_byte reads the last byte of
// the address and length pair it was given, which reads out of bounds if the two disagree.
const byteLength = $vm.ffiFunction({ args: ["buffer", "buffer_length", "i32"], returns: "u64" }, fixture("ffi_view_byte_length"), "ffi_view_byte_length");
const lastByte = $vm.ffiFunction({ args: ["buffer", "buffer_length", "i32"], returns: "i32" }, fixture("ffi_view_last_byte"), "ffi_view_last_byte");

let failures = 0;
function check(actual, expected, label) {
    if (Object.is(actual, expected))
        return;
    print(`FAIL [${label}]: got ${String(actual)} (${typeof actual}), expected ${String(expected)} (${typeof expected})`);
    if (++failures > 8)
        throw new Error("too many failures");
}

// A NEW caller function per case and per tier that holds its callable as a closure constant and
// passes exactly as many arguments as the signature takes: the only call site shape the DFG
// converts to a CallFFI node. `tag` keeps the source text unique, because two `new Function` calls
// with the same text share one unlinked code block, and then only the first caller gets the
// conversion.
function makeCaller(callable, arity, tag) {
    const argumentList = Array.from({ length: arity }, (_, i) => "args[" + i + "]").join(", ");
    return new Function("callable", `/* ${tag} */ return function (args) { return callable(${argumentList}); };`)(callable);
}

// Every call below detaches or shrinks the buffer it gets, so each one needs a buffer of its own.
const cases = [
    {
        name: "valueOf transfers the view passed for ptr",
        callable: pointerOfThenInt,
        arity: 2,
        setUp() {
            const view = new Uint8Array(64);
            return { args: [view, { valueOf() { view.buffer.transfer(); return 1; } }], expected: null };
        },
    },
    {
        name: "Symbol.toPrimitive transfers the view passed for ptr",
        callable: pointerOfThenInt,
        arity: 2,
        setUp() {
            const view = new Uint8Array(64);
            return { args: [view, { [Symbol.toPrimitive]() { view.buffer.transfer(); return 1; } }], expected: null };
        },
    },
    {
        name: "a later ptr getter transfers the view passed for ptr",
        callable: pointerOfThenPointer,
        arity: 2,
        setUp() {
            const view = new Uint8Array(64);
            return { args: [view, { get ptr() { view.buffer.transfer(); return 1; } }], expected: null };
        },
    },
    {
        name: "valueOf shrinks the view behind buffer_length",
        callable: byteLength,
        arity: 3,
        setUp() {
            const buffer = new ArrayBuffer(1024, { maxByteLength: 1024 });
            const view = new Uint8Array(buffer).fill(7);
            return { args: [view, view, { valueOf() { buffer.resize(16); return 1; } }], expected: 16n };
        },
    },
    {
        name: "the address and buffer_length still agree after a shrink",
        callable: lastByte,
        arity: 3,
        setUp() {
            const buffer = new ArrayBuffer(1024, { maxByteLength: 1024 });
            const view = new Uint8Array(buffer).fill(7);
            return { args: [view, view, { valueOf() { buffer.resize(16); return 1; } }], expected: 7 };
        },
    },
    {
        name: "valueOf transfers the view passed for cstring",
        callable: pointerOfCStringThenInt,
        arity: 2,
        setUp() {
            const view = new Uint8Array(64);
            return { args: [view, { valueOf() { view.buffer.transfer(); return 1; } }], expected: null };
        },
    },
    {
        name: "the last of 32 arguments transfers the view passed for the first",
        callable: pointerOfThenManyInts,
        arity: 32,
        setUp() {
            const view = new Uint8Array(64);
            const args = [view];
            for (let i = 1; i < 31; ++i)
                args.push(i);
            args.push({ valueOf() { view.buffer.transfer(); return 1; } });
            return { args, expected: null };
        },
    },
    {
        // The getter makes a whole FFI call of its own before the outer call reads its first
        // argument again. The answer is the live address plus the 1 the getter returned.
        name: "a nested FFI call inside a ptr getter leaves the outer arguments alone",
        callable: sumOfPointers,
        arity: 2,
        setUp() {
            const view = new Uint8Array(64);
            const nested = new Uint8Array(1024);
            const address = BigInt(pointerOfThenInt(view, 0));
            const argument = {
                get ptr() {
                    if (byteLength(nested, nested, 0) !== 1024n)
                        throw new Error("the nested call marshalled the wrong length");
                    return 1;
                },
            };
            return { args: [view, argument], expected: address + 1n };
        },
    },
    {
        name: "a live view keeps its length",
        callable: byteLength,
        arity: 3,
        setUp() {
            const view = new Uint8Array(1024).fill(7);
            return { args: [view, view, { valueOf() { return 1; } }], expected: 1024n };
        },
    },
];

function runCase(testCase, caller, label) {
    const { args, expected } = testCase.setUp();
    check(caller(args), expected, label + ": " + testCase.name);
}

for (const testCase of cases) {
    // Cold: this call site has nothing compiled yet, so the call runs the C++ host path (the IC
    // stub hands every argument that needs real conversion to it).
    runCase(testCase, makeCaller(testCase.callable, testCase.arity, "cold " + testCase.name), "cold");

    const before = $vm.ffiCompileCounts();
    const hot = makeCaller(testCase.callable, testCase.arity, "hot " + testCase.name);
    noInline(hot);
    for (let i = 0; i < 1e3; ++i)
        runCase(testCase, hot, "hot");
    // The loop must have reached the inline conversions the DFG and the FTL emit, not only the
    // host path: that is where a snapshot an earlier argument took has to be taken again.
    if (numberOfDFGCompiles(hot) > 0) {
        const counts = $vm.ffiCompileCounts();
        if (counts.dfgCallFFI + counts.ftlCallFFI === before.dfgCallFFI + before.ftlCallFFI)
            throw new Error("the DFG compiled the hot caller but no CallFFI node was compiled: " + JSON.stringify(counts));
    }
}

// A getter on a pointer argument must run exactly once: reading an address again after JS has run
// must not read the property a second time.
{
    const view = new Uint8Array(64);
    let reads = 0;
    const argument = { get ptr() { ++reads; return 1; } };
    const hot = makeCaller(pointerOfThenPointer, 2, "ptr getter runs once");
    noInline(hot);
    for (let i = 0; i < 1e3; ++i) {
        reads = 0;
        hot([view, argument]);
        if (reads !== 1)
            throw new Error("the 'ptr' getter ran " + reads + " times, expected once");
    }
    // The live view still marshals to a real address.
    check(hot([view, argument]) === null, false, "a live view has a non-null address");
}

if (failures)
    throw new Error(failures + " case(s) failed");
