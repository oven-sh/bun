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

function readHex(dv, bytes) {
    let str = "";
    function readByte(i) {
        let b = dv.getUint8(i).toString(16);
        if (b.length === 1)
            b = "0" + b;
        else
            assert(b.length === 2)
        return b;
    }
    if (isLittleEndian) {
        for (let i = bytes; i--;)
            str = str + readByte(i);
    } else {
        for (let i = 0; i < bytes; ++i)
            str = str + readByte(i);
    }

    return "0x" + str;
}

{
    let b = new ArrayBuffer(4);
    let dv = new DataView(b);
    dv.setInt32(0, 0x00112233, isLittleEndian);
    assert(readHex(dv, 4) === "0x00112233");
}

function adjustForEndianessUint16(value) {
    if (isLittleEndian)
        return value;

    let ab = new ArrayBuffer(4);
    let ta = new Uint16Array(ab);
    ta[0] = value;
    let dv = new DataView(ab);
    return dv.getUint16(0, true);
}

function test() {
    function storeLittleEndian(dv, index, value) {
        dv.setInt16(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setInt16(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setInt16(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(2);
    let arr = new Uint16Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessUint16(0xfaba));
        assert(arr[0] === 0xfaba);

        store(dv, 0, adjustForEndianessUint16(0xabcd), true);
        assert(arr[0] === 0xabcd);

        store(dv, 0, adjustForEndianessUint16(0xbadbeef), true);
        assert(arr[0] === 0xbeef);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(0xbb4db33f), true);
        assert(arr[0] === 0xb33f);

        storeBigEndian(dv, 0, adjustForEndianessUint16(0xfada));
        assert(arr[0] === 0xdafa);

        storeBigEndian(dv, 0, adjustForEndianessUint16(0x12ab));
        assert(arr[0] === 0xab12);

        store(dv, 0, adjustForEndianessUint16(0x1234), false);
        assert(arr[0] === 0x3412);

        store(dv, 0, adjustForEndianessUint16(0x0102), false);
        assert(arr[0] === 0x0201);

        store(dv, 0, adjustForEndianessUint16(-1), false);
        assert(arr[0] === 0xffff);

        store(dv, 0, adjustForEndianessUint16(-2), false);
        assert(arr[0] === 0xfeff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-1));
        assert(arr[0] === 0xffff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2));
        assert(arr[0] === 0xfeff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2147483648));
        assert(arr[0] === 0x0000);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(-2147483648));
        assert(arr[0] === 0x0000);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(-2147478988));
        assert(arr[0] === 0x1234);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2147478988));
        assert(arr[0] === 0x3412);
    }
}
test();

function test2() {
    function storeLittleEndian(dv, index, value) {
        dv.setUint16(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setUint16(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setUint16(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(2);
    let arr = new Uint16Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessUint16(0xfaba));
        assert(arr[0] === 0xfaba);

        store(dv, 0, adjustForEndianessUint16(0xabcd), true);
        assert(arr[0] === 0xabcd);

        store(dv, 0, adjustForEndianessUint16(0xbadbeef), true);
        assert(arr[0] === 0xbeef);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(0xbb4db33f), true);
        assert(arr[0] === 0xb33f);

        storeBigEndian(dv, 0, adjustForEndianessUint16(0xfada));
        assert(arr[0] === 0xdafa);

        storeBigEndian(dv, 0, adjustForEndianessUint16(0x12ab));
        assert(arr[0] === 0xab12);

        store(dv, 0, adjustForEndianessUint16(0x1234), false);
        assert(arr[0] === 0x3412);

        store(dv, 0, adjustForEndianessUint16(0x0102), false);
        assert(arr[0] === 0x0201);

        store(dv, 0, adjustForEndianessUint16(-1), false);
        assert(arr[0] === 0xffff);

        store(dv, 0, adjustForEndianessUint16(-2), false);
        assert(arr[0] === 0xfeff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-1));
        assert(arr[0] === 0xffff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2));
        assert(arr[0] === 0xfeff);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2147483648));
        assert(arr[0] === 0x0000);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(-2147483648));
        assert(arr[0] === 0x0000);

        storeLittleEndian(dv, 0, adjustForEndianessUint16(-2147478988));
        assert(arr[0] === 0x1234);

        storeBigEndian(dv, 0, adjustForEndianessUint16(-2147478988));
        assert(arr[0] === 0x3412);
    }
}
test2();

function adjustForEndianessUint32(value) {
    if (isLittleEndian)
        return value;

    let ab = new ArrayBuffer(4);
    let ta = new Uint32Array(ab);
    ta[0] = value;
    let dv = new DataView(ab);
    return dv.getUint32(0, true);
}

function test3() {
    function storeLittleEndian(dv, index, value) {
        dv.setUint32(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setUint32(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setUint32(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(4);
    let arr = new Uint32Array(buffer);
    let arr2 = new Int32Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessUint32(0xffffffff));
        assert(arr[0] === 0xffffffff);
        assert(arr2[0] === -1);

        storeLittleEndian(dv, 0, adjustForEndianessUint32(0xffaabbcc));
        assert(arr[0] === 0xffaabbcc);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0x12345678));
        assert(arr[0] === 0x78563412);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0xffaabbcc));
        assert(arr[0] === 0xccbbaaff);

        store(dv, 0, adjustForEndianessUint32(0xfaeadaca), false);
        assert(arr[0] === 0xcadaeafa);

        store(dv, 0, adjustForEndianessUint32(0xcadaeafa), false);
        assert(arr2[0] === -85271862);

        store(dv, 0, adjustForEndianessUint32(0x12345678), false);
        assert(arr[0] === 0x78563412);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0xbeeffeeb));
        assert(arr2[0] === -335614018);
    }
}
test3();

function test4() {
    function storeLittleEndian(dv, index, value) {
        dv.setInt32(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setInt32(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setInt32(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(4);
    let arr = new Uint32Array(buffer);
    let arr2 = new Int32Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessUint32(0xffffffff));
        assert(arr[0] === 0xffffffff);
        assert(arr2[0] === -1);

        storeLittleEndian(dv, 0, adjustForEndianessUint32(0xffaabbcc));
        assert(arr[0] === 0xffaabbcc);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0x12345678));
        assert(arr[0] === 0x78563412);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0xffaabbcc));
        assert(arr[0] === 0xccbbaaff);

        store(dv, 0, adjustForEndianessUint32(0xfaeadaca), false);
        assert(arr[0] === 0xcadaeafa);

        store(dv, 0, adjustForEndianessUint32(0xcadaeafa), false);
        assert(arr2[0] === -85271862);

        store(dv, 0, adjustForEndianessUint32(0x12345678), false);
        assert(arr[0] === 0x78563412);

        storeBigEndian(dv, 0, adjustForEndianessUint32(0xbeeffeeb));
        assert(arr2[0] === -335614018);
    }
}
test4();

function adjustForEndianessFloat32(value) {
    if (isLittleEndian)
        return value;

    let ab = new ArrayBuffer(4);
    let ta = new Float32Array(ab);
    ta[0] = value;
    let dv = new DataView(ab);
    return dv.getFloat32(0, true);
}

function test5() {
    function storeLittleEndian(dv, index, value) {
        dv.setFloat32(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setFloat32(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setFloat32(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(4);
    let arr = new Float32Array(buffer);
    let bits = new Uint32Array(buffer);
    let dv = new DataView(buffer);
    let f32_exponent_bits = 0x7F800000;
    let f32_fraction_bits = 0x007FFFFF;

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessFloat32(1.5));
        assert(arr[0] === 1.5);

        // The right way how to process this test is to uncomment the line below
        // and comment out the line below it. But strangely it doesn't work. I
        // opened https://bugs.webkit.org/show_bug.cgi?id=209289 for it.
        //storeLittleEndian(dv, 0, adjustForEndianessFloat32(12912.124123215122));
        store(dv, 0, 12912.124123215122, isLittleEndian);
        assert(bits[0] === 0x4649c07f);
        assert(arr[0] === 12912.1240234375);

        storeLittleEndian(dv, 0, adjustForEndianessFloat32(NaN));
        assert(isNaN(arr[0]));
        // The conversion of our initial 64-bit pure NaN (0x7ff8000000000000)
        // should yield a Float32 NaN, but we can't check for a specific binary
        // value since different CPUs might convert to different 32-bit NaNs,
        // so we just check that the bits represent a NaN.
        // The binary representation of a NaN has all its exponent bits set to
        // 1 and at least one fraction bit set to 1.
        assert(((bits[0] & f32_exponent_bits) === f32_exponent_bits) && !!(bits[0] & f32_fraction_bits))

        storeLittleEndian(dv, 0, adjustForEndianessFloat32(2.3879393e-38));
        assert(arr[0] === 2.387939260590663e-38);
        assert(bits[0] === 0x01020304);

        storeBigEndian(dv, 0, adjustForEndianessFloat32(2.3879393e-38));
        assert(arr[0] === 1.539989614439558e-36);
        assert(bits[0] === 0x04030201);
    }
}
test5();

function adjustForEndianessFloat64(value) {
    if (isLittleEndian)
        return value;

    let ab = new ArrayBuffer(8);
    let ta = new Float64Array(ab);
    ta[0] = value;
    let dv = new DataView(ab);
    return dv.getFloat64(0, true);
}

function test6() {
    function storeLittleEndian(dv, index, value) {
        dv.setFloat64(index, value, true);
    }
    noInline(storeLittleEndian);

    function storeBigEndian(dv, index, value) {
        dv.setFloat64(index, value, false);
    }
    noInline(storeBigEndian);

    function store(dv, index, value, littleEndian) {
        dv.setFloat64(index, value, littleEndian);
    }
    noInline(store);

    let buffer = new ArrayBuffer(8);
    let arr = new Float64Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        storeLittleEndian(dv, 0, adjustForEndianessFloat64(NaN));
        assert(isNaN(arr[0]));
        // The NaN we stored should be a pure NaN, so that's what we should get
        assert(readHex(dv, 8) == "0x7ff8000000000000");

        storeLittleEndian(dv, 0, adjustForEndianessFloat64(-2.5075187084135162e+284));
        assert(arr[0] === -2.5075187084135162e+284);
        assert(readHex(dv, 8) === "0xfafafafafafafafa");

        store(dv, 0, adjustForEndianessFloat64(124.553), true);
        assert(readHex(dv, 8) === "0x405f23645a1cac08");

        store(dv, 0, adjustForEndianessFloat64(Infinity), true);
        assert(readHex(dv, 8) === "0x7ff0000000000000");

        store(dv, 0, adjustForEndianessFloat64(Infinity), false);
        assert(readHex(dv, 8) === "0x000000000000f07f");

        store(dv, 0, adjustForEndianessFloat64(-Infinity), true);
        assert(readHex(dv, 8) === "0xfff0000000000000");

        storeBigEndian(dv, 0, adjustForEndianessFloat64(-2.5075187084135162e+284));
        assert(arr[0] === -2.5075187084135162e+284);
        assert(readHex(dv, 8) === "0xfafafafafafafafa");

        storeBigEndian(dv, 0, adjustForEndianessFloat64(124.553));
        assert(readHex(dv, 8) === "0x08ac1c5a64235f40");
    }
}
test6();

function test7() {
    function store(dv, index, value) {
        dv.setInt8(index, value);
    }
    noInline(store);

    let buffer = new ArrayBuffer(1);
    let arr = new Uint8Array(buffer);
    let arr2 = new Int8Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        store(dv, 0, 0xff);
        assert(arr[0] === 0xff);
        assert(arr2[0] === -1);

        store(dv, 0, 0xff00);
        assert(arr[0] === 0);
        assert(arr2[0] === 0);

        store(dv, 0, -1);
        assert(arr[0] === 0xff);
        assert(arr2[0] === -1);

        store(dv, 0, 0x0badbeef);
        assert(arr[0] === 0xef);
        assert(arr2[0] === -17);
    }
}
test7();

function test8() {
    function store(dv, index, value) {
        dv.setInt8(index, value);
    }
    noInline(store);

    let buffer = new ArrayBuffer(1);
    let arr = new Uint8Array(buffer);
    let arr2 = new Int8Array(buffer);
    let dv = new DataView(buffer);

    for (let i = 0; i < testLoopCount; ++i) {
        store(dv, 0, 0xff);
        assert(arr[0] === 0xff);
        assert(arr2[0] === -1);

        store(dv, 0, 0xff00);
        assert(arr[0] === 0);
        assert(arr2[0] === 0);

        store(dv, 0, -1);
        assert(arr[0] === 0xff);
        assert(arr2[0] === -1);

        store(dv, 0, 0x0badbeef);
        assert(arr[0] === 0xef);
        assert(arr2[0] === -17);
    }
}
test8();
