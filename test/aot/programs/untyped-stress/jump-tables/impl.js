function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function describe(value) {
    return typeof value === "symbol" ? "a symbol" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
}

const scrutinees = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 63, 64, 65, 100, 255, 256, 1000, 65535, 65536,
    -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -100, -65536,
    0x7fffffff, 0x7ffffffe, -0x80000000, -0x7fffffff, 0x80000000, 0xffffffff, 0x100000000, 0x100000003, -0x80000001, 2 ** 53, -(2 ** 53),
    -0, 0.5, 3.5, -3.5, 2.9999999999999996, 3.0000000000000004, 1e-300, 1e300, NaN, Infinity, -Infinity,
    "0", "3", "", "a", "three", "3.0", " 3", true, false, null, undefined, 3n, 0n, Symbol("3"), {}, [], [3], { valueOf() { return 3; } }, function () { },
];
function isInteger(value, from, to) { return typeof value === "number" && Math.floor(value) === value && value >= from && value <= to; }
function checkAll(f, expected, what) {
    for (let value of scrutinees)
        check(f(value), expected(value), what + " of " + describe(value));
}

function dense(x) {
    switch (x) {
    case 0: return "zero";
    case 1: return "one";
    case 2: return "two";
    case 3: return "three";
    case 4: return "four";
    case 5: return "five";
    case 6: return "six";
    case 7: return "seven";
    case 8: return "eight";
    case 9: return "nine";
    default: return "other";
    }
}
const names = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
checkAll(dense, value => isInteger(value, 0, 9) ? names[value + 0] : "other", "a dense switch");

function denseWithoutDefault(x) {
    let result = "nothing";
    switch (x) {
    case 10: result = "a"; break;
    case 11: result = "b"; break;
    case 12: result = "c"; break;
    case 13: result = "d"; break;
    case 14: result = "e"; break;
    case 15: result = "f"; break;
    case 16: result = "g"; break;
    case 17: result = "h"; break;
    }
    return result;
}
checkAll(denseWithoutDefault, value => isInteger(value, 10, 17) ? "abcdefgh"[value - 10] : "nothing", "a dense switch that does not start at zero");

function aroundZero(x) {
    switch (x) {
    case -5: return 50;
    case -4: return 40;
    case -3: return 30;
    case -2: return 20;
    case -1: return 10;
    case 0: return 0;
    case 1: return -10;
    case 2: return -20;
    case 3: return -30;
    case 4: return -40;
    case 5: return -50;
    }
    return "none";
}
checkAll(aroundZero, value => isInteger(value, -5, 5) ? value * -10 + 0 : "none", "a switch around zero");

function onlyNegative(x) {
    switch (x) {
    case -11: return 1;
    case -10: return 2;
    case -9: return 3;
    case -8: return 4;
    case -7: return 5;
    case -6: return 6;
    case -5: return 7;
    case -4: return 8;
    default: return 0;
    }
}
checkAll(onlyNegative, value => isInteger(value, -11, -4) ? value + 12 : 0, "a switch over negative numbers");

function atTheEnds(x) {
    switch (x) {
    case 0x7fffffff: return "max";
    case 0x7ffffffe: return "max - 1";
    case 0x7ffffffd: return "max - 2";
    case 0x7ffffffc: return "max - 3";
    case 0x7ffffffb: return "max - 4";
    case 0x7ffffffa: return "max - 5";
    case 0x7ffffff9: return "max - 6";
    case 0x7ffffff8: return "max - 7";
    }
    switch (x) {
    case -0x80000000: return "min";
    case -0x7fffffff: return "min + 1";
    case -0x7ffffffe: return "min + 2";
    case -0x7ffffffd: return "min + 3";
    case -0x7ffffffc: return "min + 4";
    case -0x7ffffffb: return "min + 5";
    case -0x7ffffffa: return "min + 6";
    case -0x7ffffff9: return "min + 7";
    }
    return "between";
}
checkAll(atTheEnds, value => value === 0x7fffffff ? "max" : value === 0x7ffffffe ? "max - 1" : value === -0x80000000 ? "min" : value === -0x7fffffff ? "min + 1" : "between", "switches at the ends of the range");

function withHoles(x) {
    switch (x) {
    case 0: case 1: return "low";
    case 3: return "three";
    case 4: case 6: return "even";
    case 9: return "nine";
    case 12: case 13: case 14: return "high";
    case 17: return "last";
    default: return "hole";
    }
}
checkAll(withHoles, value => {
    if (!isInteger(value, 0, 17))
        return "hole";
    return { 0: "low", 1: "low", 3: "three", 4: "even", 6: "even", 9: "nine", 12: "high", 13: "high", 14: "high", 17: "last" }[value] || "hole";
}, "a switch with holes");

function fallsThrough(x) {
    let result = "";
    switch (x) {
    case 0: result += "0";
    case 1: result += "1";
    case 2: result += "2";
    case 3: result += "3"; break;
    case 4: result += "4";
    case 5: result += "5";
    default: result += "d";
    case 6: result += "6";
    case 7: result += "7";
    }
    return result;
}
checkAll(fallsThrough, value => isInteger(value, 0, 7) ? ["0123", "123", "23", "3", "45d67", "5d67", "67", "7"][value + 0] : "d67", "cases that fall through");

function sparse(x) {
    switch (x) {
    case -65536: return 1;
    case -100: return 2;
    case 5: return 3;
    case 100: return 4;
    case 1000: return 5;
    case 65535: return 6;
    case 0x7fffffff: return 7;
    case -0x80000000: return 8;
    default: return 0;
    }
}
checkAll(sparse, value => typeof value === "number" && ({ "-65536": 1, "-100": 2, 5: 3, 100: 4, 1000: 5, 65535: 6, 2147483647: 7, "-2147483648": 8 })[value] || 0, "a sparse switch");

function few(x) {
    switch (x) {
    case 1: return "one";
    case 2: return "two";
    case 3: return "three";
    default: return "other";
    }
}
checkAll(few, value => isInteger(value, 1, 3) ? names[value] : "other", "a switch with few cases");

function ofInt32(x) {
    switch (x | 0) {
    case 0: return 100;
    case 1: return 101;
    case 2: return 102;
    case 3: return 103;
    case 4: return 104;
    case 5: return 105;
    case 6: return 106;
    case 7: return 107;
    default: return -1;
    }
}
for (let value of scrutinees) {
    if (typeof value === "symbol" || typeof value === "bigint")
        continue;
    let int32 = value | 0;
    check(ofInt32(value), int32 >= 0 && int32 <= 7 ? 100 + int32 : -1, "a switch over an Int32 made of " + describe(value));
}

function ofNumber(x) {
    switch (+x) {
    case 0: return 100;
    case 1: return 101;
    case 2: return 102;
    case 3: return 103;
    case 4: return 104;
    case 5: return 105;
    case 6: return 106;
    case 7: return 107;
    default: return -1;
    }
}
for (let value of scrutinees) {
    if (typeof value === "symbol" || typeof value === "bigint")
        continue;
    let number = +value;
    check(ofNumber(value), isInteger(number, 0, 7) ? 100 + number : -1, "a switch over a number made of " + describe(value));
}

function chain(x) {
    if (x === 20) return "a";
    if (x === 21) return "b";
    if (x === 22) return "c";
    if (x === 23) return "d";
    if (x === 24) return "e";
    if (x === 25) return "f";
    if (x === 26) return "g";
    if (x === 27) return "h";
    return "-";
}
checkAll(chain, value => isInteger(value, 20, 27) ? "abcdefgh"[value - 20] : "-", "a chain of comparisons");
check([20, 21, 22, 23, 24, 25, 26, 27, 28, 19].map(chain).join(""), "abcdefgh--", "every arm of the chain");

function inLoop(n) {
    let counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
        switch (i % 10) {
        case 0: counts[0]++; continue;
        case 1: counts[1]++; break;
        case 2: counts[2]++; continue;
        case 3: counts[3]++; break;
        case 4: counts[4]++; continue;
        case 5: counts[5]++; break;
        case 6: counts[6]++; continue;
        case 7: counts[7]++; break;
        default: continue;
        }
        counts[8]++;
    }
    return counts.join();
}
check(inLoop(25), "3,3,3,3,3,2,2,2,10", "a switch in a loop");
check(inLoop(0), "0,0,0,0,0,0,0,0,0", "a loop that is not entered");

function nested(x, y) {
    switch (x) {
    case 0: return "x0";
    case 1: return "x1";
    case 2:
        switch (y) {
        case 0: return "y0";
        case 1: return "y1";
        case 2: return "y2";
        case 3: return "y3";
        case 4: return "y4";
        case 5: return "y5";
        case 6: return "y6";
        default: return "y?";
        }
    case 3: return "x3";
    case 4: return "x4";
    case 5: return "x5";
    case 6: return "x6";
    default: return "x?";
    }
}
for (let x = -1; x <= 7; x++) {
    for (let y = -1; y <= 7; y++)
        check(nested(x, y), x === 2 ? (y >= 0 && y <= 6 ? "y" + y : "y?") : x >= 0 && x <= 6 ? "x" + x : "x?", "nested switches of " + x + " and " + y);
}

function ofCharacter(s) {
    switch (s) {
    case "a": return 1;
    case "b": return 2;
    case "c": return 3;
    case "d": return 4;
    case "e": return 5;
    case "f": return 6;
    case "g": return 7;
    case "h": return 8;
    default: return 0;
    }
}
checkAll(ofCharacter, value => value === "a" ? 1 : 0, "a switch over characters");
check([..."abcdefghi`A"].map(ofCharacter).join(""), "12345678000", "every character");
check(ofCharacter("ab") + ofCharacter("š") + ofCharacter("a".repeat(2).slice(1)) + ofCharacter(String.fromCharCode(0x100 + 97)), 1, "strings that are not among them");

function large(x) {
    switch (x) {
    case 0: return 3; case 1: return 10; case 2: return 17; case 3: return 24; case 4: return 31; case 5: return 38; case 6: return 45; case 7: return 52;
    case 8: return 59; case 9: return 66; case 10: return 73; case 11: return 80; case 12: return 87; case 13: return 94; case 14: return 101; case 15: return 108;
    case 16: return 115; case 17: return 122; case 18: return 129; case 19: return 136; case 20: return 143; case 21: return 150; case 22: return 157; case 23: return 164;
    case 24: return 171; case 25: return 178; case 26: return 185; case 27: return 192; case 28: return 199; case 29: return 206; case 30: return 213; case 31: return 220;
    case 32: return 227; case 33: return 234; case 34: return 241; case 35: return 248; case 36: return 255; case 37: return 262; case 38: return 269; case 39: return 276;
    case 40: return 283; case 41: return 290; case 42: return 297; case 43: return 304; case 44: return 311; case 45: return 318; case 46: return 325; case 47: return 332;
    case 48: return 339; case 49: return 346; case 50: return 353; case 51: return 360; case 52: return 367; case 53: return 374; case 54: return 381; case 55: return 388;
    case 56: return 395; case 57: return 402; case 58: return 409; case 59: return 416; case 60: return 423; case 61: return 430; case 62: return 437; case 63: return 444;
    default: return -1;
    }
}
checkAll(large, value => isInteger(value, 0, 63) ? value * 7 + 3 : -1, "a large switch");
for (let i = -2; i < 66; i++)
    check(large(i), i >= 0 && i <= 63 ? i * 7 + 3 : -1, "a large switch of " + i);

function lastInFunction(x) {
    let result = 0;
    switch (x) {
    case 0: result = 1; break;
    case 1: result = 2; break;
    case 2: result = 3; break;
    case 3: result = 4; break;
    case 4: result = 5; break;
    case 5: result = 6; break;
    case 6: result = 7; break;
    case 7: throw new RangeError("seven");
    }
    return result;
}
check([0, 1, 2, 3, 4, 5, 6, 8, -1].map(lastInFunction).join(), "1,2,3,4,5,6,7,0,0", "a switch with a case that throws");
let thrown = null;
try { lastInFunction(7); } catch (error) { thrown = error; }
check(thrown instanceof RangeError && thrown.message, "seven", "the case that throws");

console.log("passed");
