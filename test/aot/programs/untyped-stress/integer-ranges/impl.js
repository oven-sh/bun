function shouldBe(actual, expected) {
    if (!Object.is(actual, expected))
        throw new Error("bad value: " + actual + ", expected " + expected);
}

function countTo(n) { let c = 0; for (let i = 0; i < n; i++) c = i; return c; }
shouldBe(countTo(10), 9);
shouldBe(countTo(10.5), 10);
shouldBe(countTo(-1), 0);
shouldBe(countTo(NaN), 0);
shouldBe(countTo("7"), 6);

function pastInt32(start, steps) { let i = start; for (let k = 0; k < steps; k++) i++; return i; }
shouldBe(pastInt32(2147483645, 5), 2147483650);
shouldBe(pastInt32(4294967294, 4), 4294967298);
shouldBe(pastInt32(9007199254740990, 5), 9007199254740992);
shouldBe(pastInt32(0.5, 2), 2.5);
shouldBe(pastInt32(-0, 0), -0);

function startsAtLimit() { let i = 9007199254740990; let n = 0; for (; n < 6; n++) i++; return i; }
shouldBe(startsAtLimit(), 9007199254740992);
function endsAtLimit() { let i = -9007199254740990; let n = 0; for (; n < 6; n++) i--; return i; }
shouldBe(endsAtLimit(), -9007199254740992);

function down(n) { let s = 0; for (let i = n - 1; i >= 0; i--) s += i; return s; }
shouldBe(down(5), 10);
shouldBe(down(0), 0);

function byTwo(a) { let s = 0; for (let i = 0; i < a.length; i += 2) s += a[i]; return s; }
shouldBe(byTwo([1, 2, 3, 4, 5]), 9);

function doubling() { let x = 1; for (let i = 0; i < 70; i++) x += x; return x; }
shouldBe(doubling(), 2 ** 70);
function squaring() { let x = 3; for (let i = 0; i < 6; i++) x = x * x; return x; }
shouldBe(squaring(), 3 ** 64);

function zeroTimes(a) { let r = 0; for (let i = 0; i < 2; i++) r = i * a.length * -1; return r; }
shouldBe(zeroTimes([]), -0);
shouldBe(zeroTimes([1]), -1);
function negatedCount(n) { let r = 1; for (let i = 0; i < n; i++) r = -i; return r; }
shouldBe(negatedCount(1), -0);
shouldBe(negatedCount(3), -2);

function remainders(a) { let s = ""; for (let i = 0; i < 7; i++) s += (i % (a.length + 1)) + ","; return s; }
shouldBe(remainders([1, 2]), "0,1,2,0,1,2,0,");
function remainderOfNegative() { let r = 0; for (let i = -3; i < 0; i++) r = i % 3; return r; }
shouldBe(remainderOfNegative(), -1);
function remainderIsNegativeZero() { let r = 0; for (let i = -3; i < -2; i++) r = i % 3; return r; }
shouldBe(remainderIsNegativeZero(), -0);
function remainderByZero(a) { let r = 0; for (let i = 0; i < 2; i++) r = i % a.length; return r; }
shouldBe(remainderByZero([]), NaN);

function masks(a) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] & 255) + (a[i] >> 4) + (a[i] >>> 28); return s; }
shouldBe(masks([-1, 256, 4096]), 255 - 1 + 15 + 0 + 16 + 0 + 0 + 256 + 0);

function unsignedCounter(x) { let u = x >>> 0; for (let i = 0; i < 3; i++) u++; return u; }
shouldBe(unsignedCounter(-1), 4294967298);
shouldBe(unsignedCounter(-3), 4294967296);

function indexBeyondInt32(a) { let r; let i = 2147483646; for (let k = 0; k < 4; k++) { r = a[i]; i++; } return r; }
shouldBe(indexBeyondInt32([1, 2]), undefined);
const sparse = {}; sparse[2147483649] = "there";
shouldBe(indexBeyondInt32(sparse), "there");

function comparesWide(n) { let c = 0; for (let i = 4294967290; i < n; i++) c++; return c; }
shouldBe(comparesWide(4294967300), 10);
shouldBe(comparesWide(4294967290.5), 1);

function escapes(a) { const out = []; let i = 2147483646; for (let k = 0; k < 3; k++) { out.push(i); i++; } return out.join(); }
shouldBe(escapes(), "2147483646,2147483647,2147483648");

function bothWays(n) { let lo = 0, hi = n; while (lo < hi) { lo++; hi--; } return lo * 1000 + hi; }
shouldBe(bothWays(10), 5005);
shouldBe(bothWays(7), 4003);

function nested(n) { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c += j - i; return c; }
shouldBe(nested(5), 20);

function truthy() { let c = 0; for (let i = 3; i; i--) c++; return c; }
shouldBe(truthy(), 3);

function switches(n) { let s = ""; for (let i = 0; i < n; i++) { switch (i) { case 0: s += "a"; break; case 2: s += "c"; break; default: s += "-"; } } return s; }
shouldBe(switches(4), "a-c-");

function keys(o) { let s = ""; for (const k in o) s += k; return s; }
shouldBe(keys({ a: 1, b: 2, 3: 3 }), "3ab");
shouldBe(keys([5, 6, 7]), "012");
console.log("passed");
