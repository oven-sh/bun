// An operation on bits between an integer wider than 32 bits (a product of int32s) and a value whose type is not known: int32, doubles, NaN, infinities, -0, numbers beyond 2 ** 53, strings, booleans,
// null, undefined, objects with valueOf, big integers (TypeError), symbols (TypeError): in loops and outside them.
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
function hashOfBytes(list) { let hash = 5381, i = list.length; while (i) hash = (hash * 33) ^ list[--i]; return hash >>> 0; }
function all(h, x) {
    const wide = (h | 0) * 65599;
    return [wide ^ x, wide | x, wide & x, wide << x, wide >> x, wide >>> x, x ^ wide, x | wide, x & wide, x << wide, x >> wide, x >>> wide].join();
}
function inLoop(h, list) {
    let a = h | 0, b = h | 0, c = h | 0;
    for (let i = 0; i < list.length; i++) { a = (a * 31) ^ list[i]; b = (b * 131) | list[i]; c = ((c * 17) & list[i]) + i | 0; }
    return [a, b, c].join();
}
const values = [0, 1, -1, 255, 65536, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 1.5, -1.5, 0.1, -0, NaN, Infinity, -Infinity, 9007199254740991, 9007199254740993, 1e21, -1e21, 5e-324,
    "7", "0x10", "", "x", " 12 ", true, false, null, undefined, [], [5], [1, 2], {}, { valueOf() { return 9; } }, { valueOf() { return 2 ** 40 + 3; } }, { toString() { return "11"; } }, new Date(86400000), new Number(6)];
for (const x of values) lines.push(all(123456789, x) + " | " + all(-987654321, x));
lines.push(attempt(() => all(1, 10n)), attempt(() => all(1, Symbol.iterator)), attempt(() => all(1, { valueOf() { throw new RangeError("mine"); } })));
lines.push(hashOfBytes(new Uint8Array([1, 2, 3, 250])), hashOfBytes([1, 2, 3, 250]), hashOfBytes([1.5, "2", null, undefined, NaN, 2 ** 33 + 1]), hashOfBytes(new Float64Array([1.9, -1.9, 1e10, NaN])), hashOfBytes("abc"), hashOfBytes([]));
lines.push(inLoop(7, [1, 2, 3]), inLoop(7, [1.5, 2 ** 32 + 5, -0, NaN]), inLoop(-7, ["3", true, null, [4]]), inLoop(7, new Int32Array([-1, 2147483647, -2147483648])));
const bytes = new Uint8Array(2000); for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7;
let total = 0;
for (let i = 0; i < 300; i++) { bytes[i] = i; total = (total + hashOfBytes(bytes)) % 1000003; }
lines.push(total);
console.log(lines.join("\n"));
