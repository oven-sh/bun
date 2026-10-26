//@ requireOptions("--useDollarVM=1", "--useExecutableAllocationFuzz=false")

// A `cstring` slot whose bytes are not valid UTF-8 decodes to U+FFFD for each invalid sequence (the
// WHATWG rule: what TextDecoder and bun:ffi's `new CString(ptr)` give), and the valid text around it
// is kept. Before, one invalid byte made the whole string decode as Latin-1.
//
// Every place that boxes a cstring slot calls FFI::jsValueFromSlot, so each door below has to give
// the same string for the same bytes: a `cstring` return (cold, then hot enough for the IC stub,
// the DFG and the FTL), a callback `cstring` parameter, a threadsafe callback `cstring` parameter
// (decoded when the invocation is delivered) and $vm.ffiCString.

function codePoints(string) {
    return Array.from(string, character => character.codePointAt(0).toString(16)).join(" ");
}

function check(actual, expected, message) {
    if (typeof actual !== "string")
        throw new Error(message + ": expected a string but got " + String(actual));
    if (actual !== expected)
        throw new Error(message + ": expected [" + codePoints(expected) + "] but got [" + codePoints(actual) + "]");
}

function makeCase(name, bytes, expected) {
    return { name, bytes: new Uint8Array([...bytes, 0]), expected };
}

// The bytes of a C string, and the code points of the string it decodes to.
const shortCases = [
    ["68 c3 a9 21", "68 e9 21"], // valid: 2-byte sequence
    ["e6 97 a5 e6 9c ac", "65e5 672c"], // valid: 3-byte sequences
    ["f0 9f 98 80", "1f600"], // valid: 4-byte sequence
    ["ef bb bf 61", "feff 61"], // valid: a BOM is kept
    ["e9", "fffd"], // a Latin-1 byte alone
    ["61 e9 62", "61 fffd 62"], // a Latin-1 byte between ASCII
    ["68 65 6c 6c 6f ff", "68 65 6c 6c 6f fffd"], // ASCII, then a byte that is never valid
    ["61 c3 a9 62 ff", "61 e9 62 fffd"], // the valid 2-byte sequence before the bad byte is kept
    ["e6 97 a5 e6 9c ac e8", "65e5 672c fffd"], // a buffer cut off after a lead byte
    ["c3", "fffd"], // a lead byte alone
    ["f0 9f 98", "fffd"], // 3 of 4 bytes: one U+FFFD for the whole prefix
    ["61 80 80 62", "61 fffd fffd 62"], // continuation bytes with no lead byte: one U+FFFD each
    ["c0 80", "fffd fffd"], // overlong encoding of NUL
    ["e0 80 61", "fffd fffd 61"], // overlong 3-byte encoding
    ["ed a0 80", "fffd fffd fffd"], // a surrogate encoded as UTF-8
    ["f4 90 80 80", "fffd fffd fffd fffd"], // above U+10FFFF
    ["f8 88 80 80 80", "fffd fffd fffd fffd fffd"], // the 5-byte form
].map(([bytes, expected]) => makeCase(
    bytes,
    bytes.split(" ").map(byte => parseInt(byte, 16)),
    String.fromCodePoint(...expected.split(" ").map(codePoint => parseInt(codePoint, 16)))));

// Longer than the 1024-unit stack buffer that both decoders start with.
const longCases = (() => {
    const unitBytes = [0x68, 0xc3, 0xa9, 0x20, 0xe6, 0x97, 0xa5, 0x20, 0xf0, 0x9f, 0x98, 0x80, 0x20];
    const unitString = "h\u00e9 \u65e5 \u{1f600} ";
    const repeat = (count, unit) => Array.from({ length: count }, () => unit).flat();
    const half = repeat(200, unitBytes);
    const halfString = unitString.repeat(200);
    return [
        makeCase("long, valid", [...half, ...half], halfString + halfString),
        makeCase("long, bad byte first", [0xff, ...half, ...half], "\ufffd" + halfString + halfString),
        makeCase("long, bad byte in the middle", [...half, 0xff, ...half], halfString + "\ufffd" + halfString),
        makeCase("long, bad byte last", [...half, ...half, 0xff], halfString + halfString + "\ufffd"),
        makeCase("long, cut off inside a sequence", [...half, ...half, 0xe6, 0x97], halfString + halfString + "\ufffd"),
    ];
})();

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const echoPointerArgument = $vm.ffiFunction({ args: ["ptr"], returns: "cstring" }, fixture("ffi_echo_cstring"), "ffi_echo_cstring(ptr)");
    // A `cstring` parameter opens the call-scoped string arena, so the DFG boxes this return with exitArena = 1.
    const echoCStringArgument = $vm.ffiFunction({ args: ["cstring"], returns: "cstring" }, fixture("ffi_echo_cstring"), "ffi_echo_cstring(cstring)");
    const addressOf = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity");

    let received;
    const callback = $vm.ffiCallback({ args: ["cstring"], returns: "void" }, string => { received = string; });
    const callCallback = $vm.ffiFunction({ args: ["ptr"], returns: "void" }, callback.ptr, "callback(cstring)");
    const threadsafeCallback = $vm.ffiCallback({ args: ["cstring"], returns: "void" }, string => { received = string; }, { threadsafe: true });
    const callThreadsafeCallback = $vm.ffiFunction({ args: ["ptr"], returns: "void" }, threadsafeCallback.ptr, "threadsafe callback(cstring)");

    for (const { name, bytes, expected } of [...shortCases, ...longCases]) {
        check(echoPointerArgument(bytes), expected, name + ": cstring return");
        check(echoCStringArgument(bytes), expected, name + ": cstring return, cstring argument");
        check($vm.ffiCString(addressOf(bytes)), expected, name + ": $vm.ffiCString");

        received = undefined;
        callCallback(bytes);
        check(received, expected, name + ": callback cstring parameter");

        received = undefined;
        callThreadsafeCallback(bytes);
        if (received !== undefined)
            throw new Error(name + ": the threadsafe callback ran before it was delivered");
        const delivered = $vm.drainThreadsafeCallbacks();
        if (delivered !== 1)
            throw new Error(name + ": expected 1 delivered invocation, got " + delivered);
        check(received, expected, name + ": threadsafe callback cstring parameter");
    }

    // NULL and the empty string do not reach the decoder.
    if (echoPointerArgument(null) !== null)
        throw new Error("a NULL cstring return is null");
    if (echoPointerArgument(new Uint8Array(1)) !== "")
        throw new Error("an empty cstring return is the empty string");

    // Hot: the call sites tier up from the IC stub to DFG and FTL CallFFI. Each tier boxes the return
    // slot with operationFFIBoxSlot and has to give the same string as the cold call.
    function hot(bytes) {
        return echoPointerArgument(bytes);
    }
    noInline(hot);
    function hotWithArena(bytes) {
        return echoCStringArgument(bytes);
    }
    noInline(hotWithArena);
    function hotCallback(bytes) {
        callCallback(bytes);
        return received;
    }
    noInline(hotCallback);

    for (let i = 0; i < testLoopCount; ++i) {
        for (const { name, bytes, expected } of shortCases) {
            if (hot(bytes) !== expected)
                throw new Error(name + ": hot cstring return, iteration " + i + ": got [" + codePoints(hot(bytes)) + "]");
            if (hotWithArena(bytes) !== expected)
                throw new Error(name + ": hot cstring return with a cstring argument, iteration " + i + ": got [" + codePoints(hotWithArena(bytes)) + "]");
            if (hotCallback(bytes) !== expected)
                throw new Error(name + ": hot callback cstring parameter, iteration " + i + ": got [" + codePoints(received) + "]");
        }
    }

    callback.close();
    threadsafeCallback.close();
}

if ($vm.useJIT())
    main();
