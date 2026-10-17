// @bun
function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("bad value: " + actual + " expected: " + expected);
}

function getSetGet(dv, offset, value) {
    let before = dv.getBigInt64(offset, true);
    dv.setBigInt64(offset, value, true);
    let after = dv.getBigInt64(offset, true);
    return [before, after];
}
noInline(getSetGet);

function getTwice(dv, offset) {
    let a = dv.getBigUint64(offset, false);
    let b = dv.getBigUint64(offset, false);
    return [a, b];
}
noInline(getTwice);

function getArrayStoreGet(dv, array, index, value) {
    let before = dv.getBigUint64(index * 8, true);
    array[index] = value;
    let after = dv.getBigUint64(index * 8, true);
    return [before, after];
}
noInline(getArrayStoreGet);

const dv = new DataView(new ArrayBuffer(64));
for (let i = 0; i < testLoopCount; i++) {
    dv.setBigInt64(8, BigInt(i), true);
    let [before, after] = getSetGet(dv, 8, BigInt(-i) - 1n);
    shouldBe(before, BigInt(i));
    shouldBe(after, BigInt(-i) - 1n);

    dv.setBigUint64(16, BigInt(i) * 3n, false);
    let [a, b] = getTwice(dv, 16);
    shouldBe(a, BigInt(i) * 3n);
    shouldBe(b, BigInt(i) * 3n);
}

const buffer = new ArrayBuffer(64);
const aliasedView = new DataView(buffer);
const array = new BigUint64Array(buffer);
for (let i = 0; i < testLoopCount; i++) {
    array[2] = BigInt(i);
    let [before, after] = getArrayStoreGet(aliasedView, array, 2, BigInt(i) + (1n << 40n));
    shouldBe(before, BigInt(i));
    shouldBe(after, BigInt(i) + (1n << 40n));
}
