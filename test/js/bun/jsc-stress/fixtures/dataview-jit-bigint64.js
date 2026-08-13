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

function toUint64(v) {
    return BigInt.asUintN(64, v);
}

function toInt64(v) {
    return BigInt.asIntN(64, v);
}

function refSetBigUint64(bytes, offset, value, littleEndian) {
    let v = toUint64(value);
    for (let i = 0; i < 8; i++)
        bytes[offset + i] = Number((v >> BigInt(8 * (littleEndian ? i : 7 - i))) & 0xffn);
}

function getLE(view, offset) { return [view.getBigInt64(offset, true), view.getBigUint64(offset, true)]; }
function getBE(view, offset) { return [view.getBigInt64(offset, false), view.getBigUint64(offset, false)]; }
function getDefault(view, offset) { return [view.getBigInt64(offset), view.getBigUint64(offset)]; }
function getVar(view, offset, le) { return [view.getBigInt64(offset, le), view.getBigUint64(offset, le)]; }
noInline(getLE);
noInline(getBE);
noInline(getDefault);
noInline(getVar);

function setLE(view, offset, v) { view.setBigInt64(offset, v, true); view.setBigUint64(offset + 8, v, true); }
function setBE(view, offset, v) { view.setBigInt64(offset, v, false); view.setBigUint64(offset + 8, v, false); }
function setDefault(view, offset, v) { view.setBigInt64(offset, v); view.setBigUint64(offset + 8, v); }
function setVar(view, offset, v, le) { view.setBigInt64(offset, v, le); view.setBigUint64(offset + 8, v, le); }
noInline(setLE);
noInline(setBE);
noInline(setDefault);
noInline(setVar);

const size = 64;
const bytes = new Uint8Array(size);
const view = new DataView(bytes.buffer);

const values = [
    0n, 1n, -1n, 255n, 256n, 0x7fffffffn, 0x80000000n, 0xffffffffn, 0x100000000n,
    (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, -(1n << 63n), -(1n << 63n) + 1n,
    0x0102030405060708n, 0xf1f2f3f4f5f6f7f8n,
    (1n << 64n) + 5n, (1n << 128n) + 7n, -((1n << 64n) + 5n), -((1n << 100n) + 123n), 1n << 64n, -(1n << 64n),
];

for (let i = 0; i < testLoopCount; i++) {
    const value = values[i % values.length];
    const offset = (i * 3) % (size - 16);

    for (const le of [true, false]) {
        setVar(view, offset, value, le);
        const expected = new Uint8Array(16);
        refSetBigUint64(expected, 0, value, le);
        refSetBigUint64(expected, 8, value, le);
        for (let j = 0; j < 16; j++)
            shouldBe(bytes[offset + j], expected[j]);

        const [i64, u64] = getVar(view, offset, le);
        shouldBe(i64, toInt64(value));
        shouldBe(u64, toUint64(value));
    }

    setLE(view, offset, value);
    let [a, b] = getLE(view, offset);
    shouldBe(a, toInt64(value));
    shouldBe(b, toUint64(value));

    setBE(view, offset, value);
    [a, b] = getBE(view, offset);
    shouldBe(a, toInt64(value));
    shouldBe(b, toUint64(value));

    setDefault(view, offset, value);
    [a, b] = getDefault(view, offset);
    shouldBe(a, toInt64(value));
    shouldBe(b, toUint64(value));
    shouldBe(view.getBigUint64(offset, false), toUint64(value));
}

function oobGet(view, offset) { return view.getBigUint64(offset, true); }
function oobSet(view, offset) { view.setBigUint64(offset, 1n, true); }
noInline(oobGet);
noInline(oobSet);
for (let i = 0; i < testLoopCount; i++) {
    oobGet(view, 0);
    oobSet(view, 0);
}
for (const badOffset of [size - 7, size, -1, 0x7fffffff]) {
    shouldThrow(() => oobGet(view, badOffset), RangeError);
    shouldThrow(() => oobSet(view, badOffset), RangeError);
}

function setAny(view, offset, v) { view.setBigUint64(offset, v, true); }
noInline(setAny);
for (let i = 0; i < testLoopCount; i++)
    setAny(view, 0, 42n);
for (const bad of [42, 1.5, null, undefined, Symbol("x")])
    shouldThrow(() => setAny(view, 0, bad), TypeError);
shouldThrow(() => setAny(view, 0, {}), SyntaxError);
setAny(view, 0, "42");
shouldBe(view.getBigUint64(0, true), 42n);
setAny(view, 0, true);
shouldBe(view.getBigUint64(0, true), 1n);
setAny(view, 0, 7n);
shouldBe(view.getBigUint64(0, true), 7n);

{
    const buffer = new ArrayBuffer(16);
    const detachedView = new DataView(buffer);
    detachedView.setBigUint64(0, 0x1122334455667788n, true);
    transferArrayBuffer(buffer);
    shouldThrow(() => oobGet(detachedView, 0), TypeError);
    shouldThrow(() => oobSet(detachedView, 0), TypeError);
}

{
    const rab = new ArrayBuffer(32, { maxByteLength: 64 });
    const resizableView = new DataView(rab);
    function rget(view, offset) { return view.getBigUint64(offset, true); }
    function rset(view, offset, value) { view.setBigUint64(offset, value, true); }
    noInline(rget);
    noInline(rset);
    for (let i = 0; i < testLoopCount; i++) {
        rset(resizableView, 16, BigInt(i));
        shouldBe(rget(resizableView, 16), BigInt(i));
    }
    rab.resize(16);
    shouldThrow(() => rget(resizableView, 16), RangeError);
    rab.resize(64);
    rset(resizableView, 48, 99n);
    shouldBe(rget(resizableView, 48), 99n);
}

function gcGet(view, offset) { return view.getBigUint64(offset, true); }
noInline(gcGet);
view.setBigUint64(0, 0xdeadbeefcafebaben, true);
{
    const keep = [];
    for (let i = 0; i < 5 * testLoopCount; i++) {
        keep.push(gcGet(view, 0));
        if (keep.length > 64)
            keep.shift();
    }
    fullGC();
    for (const k of keep)
        shouldBe(k, 0xdeadbeefcafebaben);
}

function setZero(view) { view.setBigUint64(0, 0n, true); view.setBigInt64(8, 0n, true); }
noInline(setZero);
for (let i = 0; i < testLoopCount; i++) {
    view.setBigUint64(0, 0xffffffffffffffffn, true);
    view.setBigInt64(8, -1n, true);
    setZero(view);
    shouldBe(view.getBigUint64(0, true), 0n);
    shouldBe(view.getBigInt64(8, true), 0n);
}
