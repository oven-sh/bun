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

function get(dv, offset) { return dv.getBigUint64(offset, true); }
function set(dv, offset, value) { dv.setBigUint64(offset, value, true); }
noInline(get);
noInline(set);

const buffer = new ArrayBuffer(32);
const bytes = new Uint8Array(buffer);
const dv = new DataView(buffer, 8, 16);

for (let i = 0; i < testLoopCount; i++) {
    set(dv, 0, 0x0807060504030201n);
    for (let j = 0; j < 8; j++)
        shouldBe(bytes[8 + j], j + 1);
    shouldBe(get(dv, 0), 0x0807060504030201n);

    set(dv, 8, BigInt(i));
    shouldBe(get(dv, 8), BigInt(i));
    for (let j = 0; j < 8; j++)
        shouldBe(bytes[16 + j], Number((BigInt(i) >> BigInt(8 * j)) & 0xffn));
}

shouldThrow(() => get(dv, 9), RangeError);
shouldThrow(() => set(dv, 16, 1n), RangeError);
shouldThrow(() => get(dv, -1), RangeError);
