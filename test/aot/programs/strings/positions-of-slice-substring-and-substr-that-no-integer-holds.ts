// slice, substring and substr take any number for a position: it is truncated, NaN counts as 0, and what lies beyond the text is clamped, however far beyond.
const text = "0123456789";
const wide = "αβγδεζηθικ";
const positions: number[] = [
    NaN, Infinity, -Infinity, 0, -0, 0.5, -0.5, 0.999, -0.999, 1, -1, 1.5, -1.5, 9, 9.99, 10, 10.5, 11, -9, -9.99, -10, -10.5, -11,
    2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297, -4294967295, -4294967296, -4294967297,
    9007199254740991, 9007199254740992, -9007199254740991, -9007199254740992,
    9223372036854774784, 9223372036854775808, 9223372036854777856, -9223372036854774784, -9223372036854775808, -9223372036854777856,
    18446744073709551616, -18446744073709551616, 1e300, -1e300, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE,
];

function one(s: string, a: number): string {
    return s.slice(a) + "|" + s.substring(a) + "|" + s.substr(a);
}
function two(s: string, a: number, b: number): string {
    return s.slice(a, b) + "|" + s.substring(a, b) + "|" + s.substr(a, b);
}
function mix(hash: number, s: string): number {
    for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0;
    return (Math.imul(hash, 31) + s.length) | 0;
}

for (const a of positions) console.log(Object.is(a, -0) ? "-0" : String(a), one(text, a), two(text, a, 7.5), two(text, 2.5, a));

let hash = 0;
for (let round = 0; round < 40; round++)
    for (const a of positions) {
        hash = mix(hash, one(round & 1 ? wide : text, a));
        for (const b of positions) hash = mix(hash, two(round & 1 ? wide : text, a, b));
    }
console.log(hash);

// Positions that a computation makes.
function halves(s: string, n: number): string {
    let out = "";
    for (let x = -n; x <= n; x += 0.75) out += s.substring(x, x * x) + "," + s.slice(x / 0.3, -x) + "," + s.substr(Math.sqrt(x), x + n) + ";";
    return out;
}
console.log(halves(text, 4));
console.log(mix(0, halves(wide, 300)));
