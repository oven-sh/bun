// bun typed_arrays.js: what memoryview makes of the typed arrays and ArrayBuffers of JS. Prints "ok", or what is wrong.
import * as py from "./typed_arrays_helper.py";

let failures = 0;
function check(name, got, expected) {
  const a = JSON.stringify(got, (k, v) => (typeof v === "bigint" ? `${v}n` : v));
  const b = JSON.stringify(expected, (k, v) => (typeof v === "bigint" ? `${v}n` : v));
  if (a !== b) {
    failures++;
    console.log(`FAIL ${name}\n  got      ${a}\n  expected ${b}`);
  }
}

const kinds = [
  [Int8Array, "b", 1, [-1, 2, 127]],
  [Uint8Array, "B", 1, [255, 2, 0]],
  [Uint8ClampedArray, "B", 1, [255, 2, 0]],
  [Int16Array, "h", 2, [-1, 2, 32767]],
  [Uint16Array, "H", 2, [65535, 2, 0]],
  [Int32Array, "i", 4, [-1, 2, 2147483647]],
  [Uint32Array, "I", 4, [4294967295, 2, 0]],
  [Float32Array, "f", 4, [1.5, -2.25, 0.5]],
  [Float64Array, "d", 8, [1.5, -2.25, 1e300]],
];
if (typeof Float16Array !== "undefined") kinds.push([Float16Array, "e", 2, [1.5, -2.25, 0.5]]);
for (const [type, format, size, values] of kinds) {
  const array = new type(values);
  check(type.name, py.describe(array), [format, size, size * 3, false, 1, [3], [size], true, true, values]);
  const m = py.view(array);
  py.put(m, 1, 7);
  check(type.name + " written from Python", array[1], 7);
  array[2] = 9;
  check(type.name + " written from JS", py.get(m, 2), 9);
}
check("BigInt64Array", py.describe(new BigInt64Array([-1n, 2n])).slice(0, 3), ["q", 8, 16]);
check("BigUint64Array", py.describe(new BigUint64Array([1n, 2n])).slice(0, 3), ["Q", 8, 16]);
check("BigUint64Array items", py.attempt(py.tolist, py.view(new BigUint64Array([18446744073709551615n, 2n]))), "[18446744073709551615, 2]");
check("BigInt64Array items", py.attempt(py.tolist, py.view(new BigInt64Array([-9223372036854775808n, 2n]))), "[-9223372036854775808, 2]");

const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
check("ArrayBuffer", py.describe(buffer), ["B", 1, 8, false, 1, [8], [1], true, true, [1, 2, 3, 4, 5, 6, 7, 8]]);
check("DataView", py.describe(new DataView(buffer, 2, 4)), ["B", 1, 4, false, 1, [4], [1], true, true, [3, 4, 5, 6]]);
check("subarray", py.describe(new Uint8Array(buffer).subarray(3, 6)).at(-1), [4, 5, 6]);
check("Uint16Array at an offset", py.describe(new Uint16Array(buffer, 2, 2)).at(-1), [0x0403, 0x0605]);
check("empty", py.describe(new Uint8Array(0)), ["B", 1, 0, false, 1, [0], [1], true, true, []]);
check("empty ArrayBuffer", py.describe(new ArrayBuffer(0)).at(-1), []);
check("SharedArrayBuffer", py.describe(new Uint8Array(new SharedArrayBuffer(3))).at(-1), [0, 0, 0]);
check("large", py.describe(new Uint8Array(100000).fill(7)).at(-1).length, 100000);

check("conversions", py.conversions(new Uint8Array([1, 2, 3, 4])), [
  "b'\\x01\\x02\\x03\\x04'", "bytearray(b'\\x01\\x02\\x03\\x04')", "b'\\x01\\x02\\x03\\x04-\\x01\\x02\\x03\\x04'", "b'<\\x01\\x02\\x03\\x04'",
  0x04030201, "01020304", "01020304", true, true, true, 0, [2, 3], [4, 3, 2, 1], [1, 2, 3, 4],
]);
check("bytes of an Int16Array", py.attempt(x => py.conversions(x)[0], new Int16Array([1, -1])), `"b'\\\\x01\\\\x00\\\\xff\\\\xff'"`);
{
  const f = new Float32Array(2);
  py.fill(f, new Uint8Array(new Float32Array([1.5, 2.5]).buffer));
  check("filled through a cast", Array.from(f), [1.5, 2.5]);
}
check("hash", py.hashes(new Uint8Array(2)), ["ValueError: cannot hash writable memoryview object", py.hashes(new Uint8Array(2))[1]]);
check("flags", py.flags(new Int32Array([1, 2])), [
  [0, "B", 4, [2], false], [1, "B", 4, [2], false], [4, "i", 4, [2], false], [8, "B", 4, [2], false], [0x18, "B", 4, [2], false], [0x11c, "i", 4, [2], false], [0x11d, "i", 4, [2], false],
]);

// The memory of a small typed array moves when its ArrayBuffer is first asked for.
{
  const small = new Uint8Array([1, 2, 3]);
  const m = py.view(small);
  check("before .buffer", py.tolist(m), [1, 2, 3]);
  const itsBuffer = small.buffer;
  new Uint8Array(itsBuffer)[0] = 9;
  check("after .buffer", py.tolist(m), [9, 2, 3]);
  py.put(m, 1, 8);
  check("after .buffer, written", Array.from(small), [9, 8, 3]);
}
// It goes away when the ArrayBuffer is transferred.
{
  const array = new Uint8Array([1, 2, 3, 4]);
  const m = py.view(array);
  const moved = array.buffer.transfer();
  check("detached: tolist", py.attempt(py.tolist, m), "BufferError: the ArrayBuffer was detached or shrunk");
  check("detached: item", py.attempt(py.get, m, 0), "BufferError: the ArrayBuffer was detached or shrunk");
  check("detached: assignment", py.attempt(py.put, m, 0, 1), "BufferError: the ArrayBuffer was detached or shrunk");
  check("detached: a new view", py.describe(array).at(-1), []);
  check("moved", py.describe(moved).at(-1), [1, 2, 3, 4]);
}
// Or shrinks.
{
  const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
  const array = new Uint8Array(resizable);
  array.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const m = py.view(array);
  const whole = py.view(resizable);
  resizable.resize(16);
  check("grown", py.tolist(m), [1, 2, 3, 4, 5, 6, 7, 8]);
  resizable.resize(4);
  check("shrunk", py.attempt(py.tolist, m), "BufferError: the ArrayBuffer was detached or shrunk");
  check("shrunk, the buffer", py.attempt(py.tolist, whole), "BufferError: the ArrayBuffer was detached or shrunk");
  resizable.resize(8);
  check("grown again", py.tolist(m), [1, 2, 3, 4, 0, 0, 0, 0]);
}
console.log(failures ? `${failures} failed` : "ok");
