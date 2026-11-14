import { inspect, types } from "node:util";
function total(values: Uint8ClampedArray | number[]) {
  let sum = 0;
  for (const value of values) sum += Number(value);
  return sum;
}
console.log(
  total([1, 2, 3]),
  (types as any).isUint8ClampedArray(new Uint8Array(1)),
  (types as any).isUint8ClampedArray([]),
  types.isTypedArray(new Uint8Array(1)),
  ArrayBuffer.isView(new Uint8Array(1)),
);
for (const Type of <any[]>[
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
]) {
  const values = new Type([3, 1, 2]);
  const other = new Type(values.buffer.slice(0));
  console.log(
    Type.name,
    values.sort().join(""),
    values.map((value: any) => value * 2).join(""),
    values.filter((value: any) => value > 1).length,
    values.slice(1).length,
    values.subarray(1).length,
    values.indexOf(2),
    values.includes(3),
    values.reduce((a: any, b: any) => a + b, 0),
    values.toSorted().join(""),
    values.with(0, 9)[0],
    values.findLast((value: any) => value < 3),
    other.length,
    values.toLocaleString(),
    [...values.entries()].length,
    Type.from([1, 2]).length,
    Type.of(1).length,
    inspect(values),
    structuredClone(values).constructor.name,
    new Uint8Array(values).join(""),
    new Type(new Uint8Array([1, 2])).join(""),
  );
}
for (const Type of <any[]>[BigInt64Array, BigUint64Array]) {
  const values = new Type([3n, 1n, 2n]);
  console.log(
    Type.name,
    values.sort().join(""),
    values.map((value: any) => value * 2n).join(""),
    values.indexOf(2n),
    structuredClone(values).constructor.name,
  );
}
class Odd extends Uint8Array {
  static get [Symbol.species]() {
    return Int16Array;
  }
}
console.log(
  new Odd([1, 2, 3]).slice(1).constructor.name,
  new Odd([1, 2, 3]).map(value => value + 1).constructor.name,
  new Odd([1, 2, 3]).filter(value => value > 1).constructor.name,
);
const view: any = new DataView(new ArrayBuffer(16));
for (const kind of ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float16", "Float32", "Float64"]) {
  view["set" + kind](0, 3);
  console.log(kind, view["get" + kind](0));
}
view.setBigInt64(0, 5n);
view.setBigUint64(8, 6n);
console.log(view.getBigInt64(0), view.getBigUint64(8));
console.log(
  Buffer.from([1, 2, 3]).subarray(1).toString("hex"),
  Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString(),
  Buffer.from([3, 1, 2]).sort().join(""),
  (await new Blob([new Uint8Array([1, 2])]).bytes()).length,
  new TextEncoder().encode("abc").length,
  crypto.getRandomValues(new Uint8Array(4)).length,
);
const reader = new ReadableStream({
  type: "bytes",
  pull(controller: any) {
    controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    controller.close();
  },
}).getReader({ mode: "byob" });
console.log((await reader.read(new Int16Array(2))).value!.constructor.name);
console.log([3, 1, 2].sort().join(""), [1, 2, 3].map(value => value * 2).join(""), Array.from({ length: 2 }).length);
Bun.gc(true);
