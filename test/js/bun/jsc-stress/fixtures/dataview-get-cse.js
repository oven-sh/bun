// @bun
"use strict";

function assert(b) {
    if (!b)
        throw new Error;
}

function getIsLittleEndian() {
    let ab = new ArrayBuffer(2);
    let ta = new Int16Array(ab);
    ta[0] = 0x0102;
    let dv = new DataView(ab);
    return dv.getInt16(0, true) === 0x0102;
}

let isLittleEndian = getIsLittleEndian();

function adjustForEndianess(value) {
    if (isLittleEndian)
        return value;

    let ab = new ArrayBuffer(8);
    let ta = new Float64Array(ab);
    ta[0] = value;
    let dv = new DataView(ab);
    return dv.getFloat64(0, true);
}

function test1() {
    function foo(dv) {
        return [dv.getFloat32(0), dv.getFloat64(0)];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setFloat64(0, 128431.42342189432, false);
    for (let i = 0; i < testLoopCount; ++i) {
        let result = foo(dv);
        assert(result[0] !== result[1]);
    }
}
test1();

function test2() {
    function foo(dv) {
        return [dv.getFloat32(0), dv.getFloat32(0)];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setFloat64(0, 128431.42342189432, false);
    for (let i = 0; i < testLoopCount; ++i) {
        let result = foo(dv);
        assert(result[0] === result[1]);
    }
}
test2();

function test3() {
    function foo(dv, ta) {
        let a = dv.getFloat64(0, true);
        ta[0] = adjustForEndianess(Math.PI);
        let b = dv.getFloat64(0, true);
        return [a, b];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    let ta = new Float64Array(ab);
    for (let i = 0; i < 40000; ++i) {
        dv.setFloat64(0, 0.0, true);
        let result = foo(dv, ta);
        assert(result[0] === 0.0);
        assert(result[1] === Math.PI);
    }
}
test3();

function test4() {
    function foo(dv) {
        let a = dv.getInt32(0, true);
        let b = dv.getInt32(0, false);
        return [a, b];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setInt32(0, 0x11223344, true);
    for (let i = 0; i < 40000; ++i) {
        let result = foo(dv);
        assert(result[0] === 0x11223344);
        assert(result[1] === 0x44332211)
    }
}
test4();

function test5() {
    function foo(dv, littleEndian) {
        let a = dv.getInt32(0, littleEndian);
        let b = dv.getInt32(0, !littleEndian);
        return [a, b];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setInt32(0, 0x11223344, true);
    for (let i = 0; i < 40000; ++i) {
        let result = foo(dv, true);
        assert(result[0] === 0x11223344);
        assert(result[1] === 0x44332211)
    }
}
test5();

function test6() {
    function foo(dv, littleEndian) {
        let a = dv.getInt32(0, littleEndian);
        let b = dv.getInt32(0, littleEndian);
        return [a, b];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setInt32(0, 0x11223344, true);
    for (let i = 0; i < 40000; ++i) {
        let result = foo(dv, true);
        assert(result[0] === 0x11223344);
        assert(result[1] === 0x11223344)
    }
}
test6();

function test7() {
    function foo(dv) {
        let a = dv.getInt32(0, true);
        let b = dv.getInt32(4, true);
        return [a, b];
    }
    noInline(foo);

    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setInt32(0, 0x11223344, true);
    dv.setInt32(4, 0x12121212, true);
    for (let i = 0; i < 40000; ++i) {
        let result = foo(dv, true);
        assert(result[0] === 0x11223344);
        assert(result[1] === 0x12121212);
    }
}
test7();
