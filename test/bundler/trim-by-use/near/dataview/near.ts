import { types } from "node:util";
function first(view: DataView | number[]) {
  return Array.isArray(view) ? view[0] : view.byteLength;
}
const buffer = Buffer.alloc(16);
buffer.writeInt8(-3, 0);
buffer.writeUInt16LE(513, 1);
buffer.writeInt32BE(-7, 3);
buffer.writeFloatLE(1.5, 7);
buffer.writeDoubleBE(2.5, 8);
console.log(
  first([4]),
  buffer.readInt8(0),
  buffer.readUInt16LE(1),
  buffer.readInt32BE(3),
  buffer.readDoubleBE(8),
  types.isDataView(buffer),
  types.isDataView({}),
  ArrayBuffer.isView(buffer),
  ArrayBuffer.isView({}),
);
const bytes = new ArrayBuffer(8);
new Float32Array(bytes)[0] = 1.5;
console.log(
  new Uint8Array(bytes).join(","),
  new Int16Array(bytes)[1],
  new Float64Array(1).byteLength,
  bytes.slice(2).byteLength,
  new ArrayBuffer(8, { maxByteLength: 16 }).resizable,
  bytes.transfer(4).byteLength,
  bytes.detached,
  structuredClone(new Uint8Array(3)).byteLength,
);
const reader = new ReadableStream({
  type: "bytes",
  pull(controller: any) {
    controller.enqueue(new Uint8Array([1, 2]));
    controller.close();
  },
}).getReader({ mode: "byob" });
console.log((await reader.read(new Uint8Array(2))).value!.length);
Bun.gc(true);
