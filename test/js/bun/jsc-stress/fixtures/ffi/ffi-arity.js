//@ requireOptions("--useDollarVM=1")

// Arity handling (SPEC sections 3, 8.1, 8.2, 10.2): missing JS arguments are
// undefined (per-type undefined rules), extra arguments are ignored, and
// non-exact-arity call sites are simply not converted to CallFFI. Also the
// JSFunction surface: length, name, callability protocols, non-constructor.

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
    const addI32 = $vm.ffiFunction({ args: ["i32", "i32"], returns: "i32" }, fixture("ffi_add_i32"), "ffi_add_i32");
    const addF64 = $vm.ffiFunction({ args: ["f64", "f64"], returns: "f64" }, fixture("ffi_add_f64"), "ffi_add_f64");
    const addF32 = $vm.ffiFunction({ args: ["f32", "f32"], returns: "f32" }, fixture("ffi_add_f32"), "ffi_add_f32");
    const echoBool = $vm.ffiFunction({ args: ["bool"], returns: "bool" }, fixture("ffi_echo_bool"), "ffi_echo_bool");
    const echoPtr = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, fixture("ffi_echo_ptr"), "ffi_echo_ptr");
    const echoI64 = $vm.ffiFunction({ args: ["i64"], returns: "i64" }, fixture("ffi_echo_i64"), "ffi_echo_i64");
    const sum4 = $vm.ffiFunction({ args: ["i32", "i32", "i32", "i32"], returns: "i64" }, fixture("ffi_sum_i32_4"), "ffi_sum_i32_4");
    const sum0 = $vm.ffiFunction({ args: [], returns: "i64" }, fixture("ffi_sum_i32_0"), "ffi_sum_i32_0");

    // ---- JSFunction surface.
    check(addI32.length, 2, "length");
    check(sum4.length, 4, "length of ffi_sum_i32_4");
    check(sum0.length, 0, "length of ffi_sum_i32_0");
    check(addI32.name, "ffi_add_i32", "name");
    check(typeof addI32, "function", "typeof");
    check(addI32 instanceof Function, true, "instanceof Function");
    check(Object.getPrototypeOf(addI32), Function.prototype, "prototype is Function.prototype");
    let constructThrew = false;
    try {
        new addI32(1, 2);
    } catch (e) {
        constructThrew = e instanceof TypeError;
    }
    check(constructThrew, true, "new on an FFI function throws TypeError");
    let reflectConstructThrew = false;
    try {
        Reflect.construct(addI32, [1, 2]);
    } catch (e) {
        reflectConstructThrew = e instanceof TypeError;
    }
    check(reflectConstructThrew, true, "Reflect.construct on an FFI function throws TypeError");

    // ---- Missing arguments: undefined semantics per type.
    check(addI32(), 0, "add_i32()");
    check(addI32(5), 5, "add_i32(5)");
    check(addI32(undefined, undefined), 0, "add_i32(undefined, undefined)");
    check(addF64(), NaN, "add_f64() -> NaN + NaN (missing f64 args are undefined -> NaN)");
    check(addF64(1), NaN, "add_f64(1) -> 1 + NaN");
    check(echoBool(), false, "echo_bool()");
    check(echoPtr(), null, "echo_ptr() -> null pointer");
    check(sum4(1, 2), 3n, "sum_i32_4 with two arguments");
    check(sum4(), 0n, "sum_i32_4 with no arguments");
    // i64 does NOT accept undefined (SPEC section 5): missing i64 arguments throw.
    let i64Threw = false;
    try {
        echoI64();
    } catch (e) {
        i64Threw = e instanceof TypeError;
    }
    check(i64Threw, true, "echo_i64() with a missing i64 argument throws TypeError");
    // f32 follows the same loose rule as f64: a missing argument is undefined -> NaN.
    check(addF32(1.5), NaN, "add_f32(1.5) with a missing f32 argument is 1.5 + NaN");

    // ---- Extra arguments are ignored.
    check(addI32(1, 2, 3), 3, "add_i32(1,2,3)");
    check(addI32(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), 3, "add_i32 with 12 arguments");
    check(sum0(1, 2, 3), 0n, "sum_i32_0 with extra arguments");
    check(echoBool(true, Symbol("ignored"), {}), true, "extra arguments of unconvertible types are ignored");
    check(addI32(1, 2, Symbol("ignored")), 3, "extra symbol argument is ignored");

    // ---- Call protocols.
    check(addI32.call(undefined, 40, 2), 42, "call");
    check(addI32.call(null, 40, 2, 99), 42, "call with extra");
    check(addI32.call({}, 40), 40, "call with this and a missing argument");
    check(addI32.apply(undefined, [40, 2]), 42, "apply");
    check(addI32.apply(undefined, [40]), 40, "apply short");
    check(addI32.apply(undefined, [40, 2, 3, 4]), 42, "apply long");
    check(addI32.apply(undefined), 0, "apply without a list");
    check(addI32(...[40, 2]), 42, "spread");
    check(addI32(...[40]), 40, "spread short");
    check(addI32(...new Array(30).fill(1)), 2, "spread of 30 ones");
    const bound = addI32.bind(null, 40);
    check(bound(2), 42, "bound one argument");
    check(bound(), 40, "bound with a missing argument");
    check(bound(2, 3), 42, "bound with an extra argument");
    check(Reflect.apply(addI32, undefined, [40, 2]), 42, "Reflect.apply");
    check([[1, 2], [3, 4], [5, 6]].map(pair => addI32(...pair)).join(","), "3,7,11", "used in map");
    check(Array.from([[1, 2], [3, 4]], ([a, b]) => addI32(a, b)).join(","), "3,7", "used in Array.from");
    // Passing the FFI function itself as a callback to a builtin.
    check([1, 2, 3].reduce(addI32), 6, "reduce with the FFI function directly (extra index/array arguments ignored)");

    // ---- Hot exact-arity vs hot non-exact-arity call sites.
    function exact(a, b) { return addI32(a, b); }
    function missingOne(a) { return addI32(a); }
    function extraOne(a, b, c) { return addI32(a, b, c); }
    function viaCall(a, b) { return addI32.call(undefined, a, b); }
    function viaApply(a, b) { return addI32.apply(undefined, [a, b]); }
    function viaSpread(pair) { return addI32(...pair); }
    noInline(exact); noInline(missingOne); noInline(extraOne); noInline(viaCall); noInline(viaApply); noInline(viaSpread);
    for (let i = 0; i < 3e4; ++i) {
        check(exact(i, 1), (i + 1) | 0, "hot exact");
        check(missingOne(i), i | 0, "hot missing one");
        check(extraOne(i, 2, 999), (i + 2) | 0, "hot extra one");
        check(viaCall(i, 3), (i + 3) | 0, "hot via call");
        check(viaApply(i, 4), (i + 4) | 0, "hot via apply");
        check(viaSpread([i, 5]), (i + 5) | 0, "hot via spread");
    }
    // After tier-up, the same sites with the "wrong" number of arguments.
    check(exact(1), 1, "exact site called with one argument after tier-up");
    check(exact(1, 2, 3), 3, "exact site called with three arguments after tier-up");
    // missingOne(a) forwards only `a`; its extra argument (2) never reaches the
    // inner one-argument FFI call site, so this is still addI32(1, undefined) = 1 + 0.
    check(missingOne(1, 2), 1, "missingOne site called with two arguments");
    check(extraOne(1), 1, "extraOne site called with one argument");

    // A varargs wrapper (arity unknown at the site).
    function varargs(...args) { return addI32(...args); }
    noInline(varargs);
    for (let i = 0; i < 2e4; ++i)
        check(varargs(i, i), (i + i) | 0, "hot varargs");
    check(varargs(), 0, "varargs()");
    check(varargs(7), 7, "varargs(7)");
    check(varargs(1, 2, 3), 3, "varargs(1,2,3)");

    // arguments object interplay.
    function withArguments() { return addI32.apply(null, arguments); }
    check(withArguments(9, 10), 19, "arguments object apply");
    check(withArguments(9), 9, "arguments object apply short");
}

if ($vm.useJIT())
    main();
