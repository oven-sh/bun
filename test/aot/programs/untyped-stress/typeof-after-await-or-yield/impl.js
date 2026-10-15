function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
let log = [];
function mix(t) { t = (t ^ 5) + (t | 3); if (t < 0) t = -t; t = t % 1000; t += (t & 7) - (t >> 1); if (t > 9) t -= 9; else t += 9; t = (t ^ 5) + (t | 3); if (t < 0) t = -t; return t % 1000; }
function takesObject(o) { log.push(o.a); return o.a + mix(1); }
function takesString(s) { log.push(s.length); return s.length + mix(2); }
function takesNumber(n) { log.push(n); return n + mix(3); }
function takesDouble(d) { log.push(d); return d * 2 + mix(4); }
function takesBoolean(b) { log.push(b); return b ? mix(5) : mix(6); }
async function testsObject(i, c) { let x = i & 1 ? { a: i } : undefined; if (c) await 1; else await 2; if (!x) return -1; let r = takesObject(x); await 3; return r; }
async function testsString(i, c) { let s = i & 1 ? "s" + i : undefined; if (c) await 1; else await 2; if (s === undefined) return -1; let r = takesString(s); await 3; return r; }
async function testsNumber(i, c) { let n = i & 1 ? i : undefined; if (c) await 1; else await 2; if (n === undefined) return -1; let r = takesNumber(n); await 3; return r; }
async function testsDouble(i, c) { let d = i & 1 ? i + 0.5 : null; if (c) await 1; else await 2; if (d === null) return -1; let r = takesDouble(d); await 3; return r; }
async function testsBoolean(i, c) { let b = i & 1 ? i > 2 : undefined; if (c) await 1; else await 2; if (b === undefined) return -1; let r = takesBoolean(b); await 3; return r; }
async function doesNotTest(i, c) { let x = i & 1 ? { a: i } : undefined; if (c) await 1; else await 2; let r = takesAnything(x); await 3; return r; }
function takesAnything(x) { log.push(typeof x); return x === undefined ? mix(7) : x.a + mix(8); }
function* yieldsThenTests(i, c) { let x = i & 1 ? { a: i } : undefined; if (c) yield 1; else yield 2; if (!x) return -1; let r = takesObject(x); yield 3; return r; }

let results = { };
for (let i = 0; i < 4; i++) {
    testsObject(i, i & 2).then(v => { results["testsObject" + i] = v; });
    testsString(i, i & 2).then(v => { results["testsString" + i] = v; });
    testsNumber(i, i & 2).then(v => { results["testsNumber" + i] = v; });
    testsDouble(i, i & 2).then(v => { results["testsDouble" + i] = v; });
    testsBoolean(i, i & 2).then(v => { results["testsBoolean" + i] = v; });
    doesNotTest(i, i & 2).then(v => { results["doesNotTest" + i] = v; });
}
drainMicrotasks();
for (let i = 0; i < 4; i++) {
    let passes = i & 1;
    check(results["testsObject" + i], passes ? i + mix(1) : -1, "an object or undefined, " + i);
    check(results["testsString" + i], passes ? 2 + mix(2) : -1, "a string or undefined, " + i);
    check(results["testsNumber" + i], passes ? i + mix(3) : -1, "a number or undefined, " + i);
    check(results["testsDouble" + i], passes ? (i + 0.5) * 2 + mix(4) : -1, "a double or null, " + i);
    check(results["testsBoolean" + i], passes ? (i > 2 ? mix(5) : mix(6)) : -1, "a boolean or undefined, " + i);
    check(results["doesNotTest" + i], passes ? i + mix(8) : mix(7), "a value that is not tested, " + i);
}
check(log.map(String).sort().join(), "1,1,1.5,2,2,3,3,3.5,false,object,object,true,undefined,undefined", "what the callees were given");
for (let i = 0; i < 4; i++) {
    let values = [...yieldsThenTests(i, i & 2)];
    check(values.join(), i & 1 ? (i & 2 ? "1,3" : "2,3") : (i & 2 ? "1" : "2"), "what a generator yields");
}
})();
console.log("passed");
