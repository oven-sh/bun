// view.byteLength, view.byteOffset and view.length, read by name in untyped code: of every kind of typed array, whole and part of a buffer, empty, of a subclass, with the buffer transferred away,
// over a resizable buffer (tracking its length and not), of a DataView; and the same getters asked of what is no typed array.
const lines = [];
function measure(view) { return view.byteLength + "/" + view.byteOffset + "/" + view.length; }
function tryMeasure(x) { try { return measure(x); } catch (error) { return error.constructor.name; } }
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
if (typeof Float16Array === "function") kinds.push(Float16Array);
for (const Kind of kinds) {
    const buffer = new ArrayBuffer(64);
    const row = [Kind.name];
    for (let round = 0; round < 3; round++) {
        row.push(measure(new Kind(0)), measure(new Kind(5)), measure(new Kind(buffer)), measure(new Kind(buffer, 16)), measure(new Kind(buffer, 8, 2)), measure(new Kind(buffer).subarray(1, 3)), measure(new Kind(3000)));
    }
    lines.push(row.join(" "));
}
class Bytes extends Uint8Array { get extra() { return this.byteLength * 2; } }
const bytes = new Bytes(7);
lines.push(measure(bytes) + " " + bytes.extra + " " + measure(bytes.subarray(2)));
class Odd extends Uint16Array { get byteLength() { return "mine"; } }
lines.push(measure(new Odd(4)), measure(new Odd(4)));
const moved = new Uint32Array(new ArrayBuffer(32), 8, 4);
lines.push(measure(moved));
moved.buffer.transfer();
lines.push(measure(moved), measure(moved));
const resizable = new ArrayBuffer(16, { maxByteLength: 64 });
const tracking = new Uint16Array(resizable, 4);
const fixed = new Uint16Array(resizable, 4, 4);
lines.push(measure(tracking) + " " + measure(fixed));
resizable.resize(40);
lines.push(measure(tracking) + " " + measure(fixed));
resizable.resize(8);
lines.push(measure(tracking) + " " + measure(fixed));
resizable.resize(2);
lines.push(measure(tracking) + " " + measure(fixed));
const data = new DataView(new ArrayBuffer(24), 4, 12);
lines.push(data.byteLength + "/" + data.byteOffset + "/" + data.length);
const others = [Object.create(Uint8Array.prototype), Uint8Array.prototype, Object.getPrototypeOf(Uint8Array.prototype), {}, [], "text", 5, { byteLength: 1, byteOffset: 2, length: 3 }, new ArrayBuffer(9), null];
lines.push(others.map(tryMeasure).join(" "), others.map(tryMeasure).join(" "));
const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get;
const borrowed = Object.defineProperty({}, "byteLength", { get: getter });
lines.push(tryMeasure(borrowed), tryMeasure(borrowed));
const lent = Object.defineProperty(new Float64Array(3), "size", { get: getter });
lines.push(String(lent.size), String(lent.size));
let total = 0;
const pool = kinds.map((Kind, i) => new Kind(new ArrayBuffer(128), 8 * (i % 4), i + 1));
for (let round = 0; round < 200; round++)
    for (const view of pool) total += view.byteLength + view.byteOffset;
lines.push(String(total));
console.log(lines.join("\n"));
