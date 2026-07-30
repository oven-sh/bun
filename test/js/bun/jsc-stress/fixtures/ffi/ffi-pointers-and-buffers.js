//@ requireOptions("--useDollarVM=1")

// Pointer-family conversions: TypedArray / DataView / ArrayBuffer / number
// arguments, detached views, cstring transcoding of JS strings (a new
// capability, SPEC section 5), pointer round trips and raw memory pokes via
// $vm.ffiRead / $vm.ffiWrite.

function describe(value) {
    if (typeof value === "bigint")
        return String(value) + "n";
    if (Object.is(value, -0))
        return "-0";
    return String(value);
}

function check(actual, expected, message) {
    if (!Object.is(actual, expected))
        throw new Error(message + ": expected " + describe(expected) + " but got " + describe(actual));
}

function main() {
    const fixture = name => $vm.ffiFixture(name);
    const bind = (name, args, ret) => $vm.ffiFunction({ args, returns: ret }, fixture(name), name);

    const ptrIdentity = bind("ffi_ptr_identity", ["ptr"], "ptr");
    const ptrWriteU32 = bind("ffi_ptr_write_u32", ["ptr", "u32"], "void");
    const ptrReadU32 = bind("ffi_ptr_read_u32", ["ptr"], "u32");
    const strlen = bind("ffi_strlen", ["cstring"], "u64");
    const highPtr = bind("ffi_high_ptr", [], "ptr");
    const retNullPtr = bind("ffi_ret_null_ptr", [], "ptr");
    const echoPtr = bind("ffi_echo_ptr", ["ptr"], "ptr");
    const echoCString = bind("ffi_echo_cstring", ["cstring"], "cstring");
    const bufferArg = $vm.ffiFunction({ args: ["buffer"], returns: "ptr" }, fixture("ffi_ptr_identity"), "ffi_ptr_identity(buffer)");

    // ---- Null in, null out.
    check(retNullPtr(), null, "ffi_ret_null_ptr()");
    check(ptrIdentity(0), null, "ffi_ptr_identity(0)");
    check(ptrIdentity(null), null, "ffi_ptr_identity(null)");
    check(ptrIdentity(undefined), null, "ffi_ptr_identity(undefined)");
    check(echoPtr(0), null, "ffi_echo_ptr(0)");
    check(echoPtr(null), null, "ffi_echo_ptr(null)");

    // ---- TypedArray / DataView / ArrayBuffer addresses are consistent.
    const buffer = new ArrayBuffer(64);
    const u8 = new Uint8Array(buffer);
    const u32 = new Uint32Array(buffer);
    const u32Offset = new Uint32Array(buffer, 8, 4);
    const dataView = new DataView(buffer, 12, 8);
    const base = ptrIdentity(u8);
    check(typeof base, "number", "typed array address typeof");
    if (!(base > 0))
        throw new Error("expected a positive address, got " + base);
    check(ptrIdentity(u8), base, "address is stable");
    check(ptrIdentity(u32), base, "views of the same buffer share the base address");
    check(ptrIdentity(buffer), base, "ArrayBuffer -> data()");
    check(ptrIdentity(u32Offset), base + 8, "byteOffset is honored (Uint32Array)");
    check(ptrIdentity(dataView), base + 12, "byteOffset is honored (DataView)");
    check(ptrIdentity(u8.subarray(3)), base + 3, "byteOffset is honored (subarray)");
    check(bufferArg(u32Offset), base + 8, "Type::Buffer view");
    check(ptrIdentity(base), base, "numeric pointer round trip");
    check(echoPtr(base + 5), base + 5, "numeric pointer arithmetic round trip");

    // ---- Writes/reads through native pointers.
    ptrWriteU32(u32, 0xdeadbeef);
    check(u32[0], 0xdeadbeef >>> 0, "ffi_ptr_write_u32 through a Uint32Array");
    ptrWriteU32(u32Offset, 7);
    check(u32[2], 7, "ffi_ptr_write_u32 through an offset view");
    ptrWriteU32(base + 4, 0x11223344);
    check(u32[1], 0x11223344, "ffi_ptr_write_u32 through a numeric pointer");
    u32[3] = 0xffffffff;
    check(ptrReadU32(u32Offset.subarray(1)), 4294967295, "ffi_ptr_read_u32 returns unsigned above INT32_MAX");
    u32[3] = 0x80000000;
    check(ptrReadU32(base + 12), 2147483648, "ffi_ptr_read_u32 of 0x80000000");
    ptrWriteU32(u32, -1); // u32 argument: toInt32 then reinterpret
    check(u32[0], 4294967295, "u32 argument -1 wraps to 0xffffffff");
    ptrWriteU32(u32, 4294967296 + 9);
    check(u32[0], 9, "u32 argument wraps mod 2^32");

    // ---- $vm.ffiRead / $vm.ffiWrite over the same memory.
    $vm.ffiWrite(base, "u8", 200);
    check(u8[0], 200, "$vm.ffiWrite u8");
    check($vm.ffiRead(base, "u8"), 200, "$vm.ffiRead u8");
    check($vm.ffiRead(base, "i8"), -56, "$vm.ffiRead i8 sign");
    const f64 = new Float64Array(buffer, 32, 2);
    $vm.ffiWrite(base + 32, "f64", -0.5);
    check(f64[0], -0.5, "$vm.ffiWrite f64");
    f64[1] = Math.PI;
    check($vm.ffiRead(base + 40, "f64"), Math.PI, "$vm.ffiRead f64");
    $vm.ffiWrite(base + 32, "f32", 1.5);
    check(new Float32Array(buffer, 32, 1)[0], 1.5, "$vm.ffiWrite f32");
    $vm.ffiWrite(base + 8, "i32", -123456789);
    check($vm.ffiRead(base + 8, "i32"), -123456789, "$vm.ffiRead i32");
    check(new Int32Array(buffer, 8, 1)[0], -123456789, "$vm.ffiWrite i32 visible to JS");

    // ---- cstring arguments: JS strings are transcoded to NUL-terminated UTF-8.
    check(strlen("hello"), 5n, 'strlen("hello")');
    check(strlen(""), 0n, 'strlen("")');
    check(strlen("héllo"), 6n, "strlen of a Latin-1 string counts UTF-8 bytes");
    check(strlen("\u{1D11E}"), 4n, "strlen of an astral character counts 4 UTF-8 bytes");
    check(strlen("→←"), 6n, "strlen of two BMP arrows");
    check(strlen("mixed é \u{1F600} end"), BigInt(6 + 2 + 1 + 4 + 4), "strlen mixed");
    let rope = "";
    for (let i = 0; i < 200; ++i)
        rope += "ab"; // built by concatenation -> rope until resolved
    check(strlen(rope), 400n, "strlen of a rope");
    let astralRope = "";
    for (let i = 0; i < 50; ++i)
        astralRope += "\u{1D11E}x";
    check(strlen(astralRope), 250n, "strlen of an astral rope");
    // A NUL-containing string is truncated at the NUL by strlen (the copy is faithful).
    check(strlen("abc\0def"), 3n, "strlen stops at embedded NUL");
    // TypedArrays are also accepted for cstring parameters (pointer semantics).
    const cstringBytes = new Uint8Array([0x66, 0x66, 0x69, 0x00, 0x21]); // "ffi\0!"
    check(strlen(cstringBytes), 3n, "strlen of a Uint8Array cstring");
    check(strlen(cstringBytes.subarray(1)), 2n, "strlen of a Uint8Array subarray cstring");

    const utf8Bytes = new Uint8Array([0x68, 0xc3, 0xa9, 0x21, 0x00]); // "hé!"
    check(echoCString(utf8Bytes), "hé!", "ffi_echo_cstring decodes the returned UTF-8 to a string");
    check($vm.ffiCString(ptrIdentity(utf8Bytes)), "hé!", "$vm.ffiCString decodes UTF-8");
    check($vm.ffiCString(ptrIdentity(cstringBytes)), "ffi", "$vm.ffiCString stops at NUL");
    check(echoCString(0), null, "ffi_echo_cstring(0) is null");
    check(echoCString("round trip"), "round trip", "a JS string round-trips through cstring");
    check(echoCString(null), null, "ffi_echo_cstring(null)");
    check(echoCString("transient"), "transient", "arena-copied cstring argument round-trips");

    // ---- ffi_high_ptr: full 47-bit user-space pointer round trip.
    check(highPtr(), 0x00007fffdeadbee0, "ffi_high_ptr()");
    check(ptrIdentity(highPtr()), 0x00007fffdeadbee0, "ffi_high_ptr round trip through ffi_ptr_identity");
    check(ptrIdentity(0x00007fffdeadbee0), 0x00007fffdeadbee0, "high pointer literal round trip");
    // Sign-extension of int32 pointer arguments: -1 becomes all-ones. That
    // address exceeds 2^53, so it comes back as an EXACT BigInt rather than a
    // lossy double (SPEC section 5 pointer rule, oven-sh/bun#28068).
    check(ptrIdentity(-1), 18446744073709551615n, "ffi_ptr_identity(-1) reads back as exactly 0xFFFFFFFFFFFFFFFF");
    check(ptrIdentity(-4096), 18446744073709547520n, "ffi_ptr_identity(-4096) sign-extends (exact)");
    // ...and a BigInt address round-trips back into a pointer argument unchanged.
    check(ptrIdentity(18446744073709551615n), 18446744073709551615n, "BigInt pointer argument round trip");
    check(ptrIdentity(0x123456789abn), 0x123456789ab, "small BigInt pointer comes back as a plain number");

    // ---- Detached buffers: vector() is null, so the pointer is 0 -> null (SPEC section 5).
    {
        const detachable = new ArrayBuffer(16);
        const detachedView = new Uint8Array(detachable);
        if (typeof transferArrayBuffer === "function")
            transferArrayBuffer(detachable);
        else
            detachable.transfer();
        if (detachedView.length !== 0)
            throw new Error("expected a detached view");
        for (let i = 0; i < 3; ++i)
            check(ptrIdentity(detachedView), null, "detached TypedArray converts to a null pointer (iteration " + i + ")");
    }

    // ---- Hot loops: cell arguments through the JIT tiers with GC pressure.
    const hot = new Uint32Array(4);
    for (let i = 0; i < 3e4; ++i) {
        ptrWriteU32(hot, i);
        if (hot[0] !== (i >>> 0))
            throw new Error("hot ffi_ptr_write_u32 iteration " + i);
        if (ptrReadU32(hot) !== (i >>> 0))
            throw new Error("hot ffi_ptr_read_u32 iteration " + i);
    }
    for (let i = 0; i < 5000; ++i) {
        // Temporary view: must stay alive for the duration of the call even
        // though nothing but the call references it (conservative scan /
        // DFG keep-alive, SPEC section 15.1).
        ptrWriteU32(new Uint32Array(2), i);
        if ((i & 511) === 0)
            gc();
    }
    for (let i = 0; i < 2e4; ++i) {
        if (strlen("tier " + (i & 7)) !== 6n)
            throw new Error("hot strlen iteration " + i);
    }
    let stableString = "stable string";
    for (let i = 0; i < 3e4; ++i) {
        if (strlen(stableString) !== 13n)
            throw new Error("hot strlen (stable) iteration " + i);
    }
    const hotAddress = ptrIdentity(hot);
    for (let i = 0; i < 2e4; ++i) {
        if (highPtr() !== 0x00007fffdeadbee0)
            throw new Error("hot ffi_high_ptr iteration " + i);
        if (retNullPtr() !== null)
            throw new Error("hot ffi_ret_null_ptr iteration " + i);
        if (ptrIdentity(hot) !== hotAddress)
            throw new Error("hot typed array address changed at iteration " + i);
        if (ptrIdentity(hotAddress) !== hotAddress)
            throw new Error("hot numeric pointer round trip iteration " + i);
    }
}

if ($vm.useJIT())
    main();
