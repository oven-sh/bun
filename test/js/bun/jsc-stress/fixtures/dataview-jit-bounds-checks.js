// @bun
"use strict";

function assert(b, m = "") {
    if (!b)
        throw new Error("Bad: " + m);
}

let getOps = {
    getUint8: 1,
    getUint16: 2,
    getUint32: 4,
    getInt8: 1,
    getInt16: 2,
    getInt32: 4,
    getFloat32: 4,
    getFloat64: 8,
    getBigInt64: 8,
    getBigUint64: 8,
};

let setOps = {
    setUint8: 1,
    setUint16: 2,
    setUint32: 4,
    setInt8: 1,
    setInt16: 2,
    setInt32: 4,
    setFloat32: 4,
    setFloat64: 8,
    setBigInt64: 8,
    setBigUint64: 8,
};

let getFuncs = [];
for (let p of Object.keys(getOps)) {
    let endOfCall = getOps[p] === 1 ? ");" : ", true);";
    let str = `
        (function ${p}(dv, index) {
            return dv.${p}(index${endOfCall}
        })
    `;
       
    let func = eval(str);
    noInline(func);
    getFuncs.push(func);
}

let setFuncs = [];
for (let p of Object.keys(setOps)) {
    let endOfCall = setOps[p] === 1 ? ");" : ", true);";
    let str = `
        (function ${p}(dv, index, value) {
            return dv.${p}(index, value${endOfCall}
        })
    `;

    let func = eval(str);
    noInline(func);
    setFuncs.push(func);
}

function valueFor(name) {
    return name.indexOf("Big") !== -1 ? 10n : 10;
}

function assertThrowsRangeError(f) {
    let e = null;
    try {
        f();
    } catch(err) {
        e = err;
    }
    assert(e instanceof RangeError, e);
}

function test(warmup) {
    const size = 16*1024;
    let ab = new ArrayBuffer(size);
    let dv = new DataView(ab);
    for (let i = 0; i < warmup; ++i) {
        for (let f of getFuncs) {
            f(dv, 0);
        }

        for (let f of setFuncs) {
            f(dv, 0, valueFor(f.name));
        }
    }

    for (let f of getFuncs) {
        assertThrowsRangeError(() => {
            let index = size - getOps[f.name] + 1;
            f(dv, index);
        });
        assertThrowsRangeError(() => {
            let index = -1;
            f(dv, index);
        });
        assertThrowsRangeError(() => {
            let index = -2147483648;
            f(dv, index);
        });
    } 

    for (let f of setFuncs) {
        assertThrowsRangeError(() => {
            let index = size - setOps[f.name] + 1;
            f(dv, index, valueFor(f.name));
        });
        assertThrowsRangeError(() => {
            let index = -1;
            f(dv, index, valueFor(f.name));
        });
        assertThrowsRangeError(() => {
            let index = -2147483648;
            f(dv, index, valueFor(f.name));
        });
    }
}

test(2000);
test(10000);
