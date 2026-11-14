const view: any = new DataView(new ArrayBuffer(16), 2, 12);
for (const kind of ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float16", "Float32", "Float64"]) {
  view["set" + kind](0, 3, true);
  console.log(kind, view["get" + kind](0, true), view["get" + kind](0));
}
console.log(
  view.byteLength,
  view.byteOffset,
  view.buffer.byteLength,
  Object.prototype.toString.call(view),
  ArrayBuffer.isView(view),
  structuredClone(view).byteLength,
  view instanceof DataView,
);
try {
  view.getInt32(10);
} catch (error) {
  console.log((error as Error).name);
}
console.log(new DataView(new ArrayBuffer(8, { maxByteLength: 16 })).byteLength, new Uint8Array(view.buffer).join(""));
Bun.gc(true);
