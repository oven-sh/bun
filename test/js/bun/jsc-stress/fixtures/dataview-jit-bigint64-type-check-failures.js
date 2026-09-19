// @bun
function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("bad value: " + actual + " expected: " + expected);
}

function shouldThrow(func, errorType) {
    let error = null;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof errorType))
        throw new Error("bad error: " + error);
}

function get(dv, offset, littleEndian) { return dv.getBigUint64(offset, littleEndian); }
function set(dv, offset, value, littleEndian) { dv.setBigUint64(offset, value, littleEndian); }
noInline(get);
noInline(set);

const dv = new DataView(new ArrayBuffer(64));
for (let i = 0; i < testLoopCount; i++) {
    set(dv, 8, 0x0102030405060708n, true);
    shouldBe(get(dv, 8, true), 0x0102030405060708n);
}

shouldBe(get(dv, 8.9, true), 0x0102030405060708n);
shouldBe(get(dv, "8", true), 0x0102030405060708n);
shouldBe(get(dv, [8], true), 0x0102030405060708n);
shouldThrow(() => get(dv, 8n, true), TypeError);
shouldThrow(() => get(dv, Symbol("8"), true), TypeError);
shouldBe(get(dv, NaN, true), 0n);

set(dv, 16.7, 0xa1a2a3a4a5a6a7a8n, true);
shouldBe(get(dv, 16, true), 0xa1a2a3a4a5a6a7a8n);
shouldThrow(() => set(dv, 8n, 1n, true), TypeError);

shouldBe(get(dv, 8, 1), 0x0102030405060708n);
shouldBe(get(dv, 8, "yes"), 0x0102030405060708n);
shouldBe(get(dv, 8, undefined), 0x0807060504030201n);
shouldBe(get(dv, 8, null), 0x0807060504030201n);
shouldBe(get(dv, 8, {}), 0x0102030405060708n);
set(dv, 24, 0x1112131415161718n, 0);
shouldBe(get(dv, 24, false), 0x1112131415161718n);

shouldThrow(() => get({}, 0, true), TypeError);
shouldThrow(() => get(new Uint8Array(64), 0, true), TypeError);
shouldThrow(() => set(null, 0, 1n, true), TypeError);
shouldThrow(() => get.call(undefined, DataView.prototype, 0, true), TypeError);
