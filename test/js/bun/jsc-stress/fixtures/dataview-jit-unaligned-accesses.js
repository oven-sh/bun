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
            dv.${p}(index, value${endOfCall}
        })
    `;

    let func = eval(str);
    noInline(func);
    setFuncs.push(func);
}

function test() {
    const size = 16*1024;
    let ab = new ArrayBuffer(size);
    let dv = new DataView(ab);
    for (let i = 0; i < testLoopCount; ++i) {
        let index = (Math.random() * size) >>> 0;
        index = Math.max(index - 8, 0);
        for (let f of getFuncs) {
            f(dv, index);
        }

        for (let f of setFuncs) {
            f(dv, index, f.name.indexOf("Big") !== -1 ? 10n : 10);
        }
    }

}
test();
