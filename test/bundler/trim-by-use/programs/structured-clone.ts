const cycle: any = {
  name: "cycle",
  map: new Map([["k", { deep: [1, 2, 3] }]]),
  set: new Set(["a"]),
  date: new Date(86400000),
  pattern: /x+/gi,
  big: 12345678901234567890n,
};
cycle.self = cycle;
cycle.bytes = new Uint8Array([1, 2, 3]);
cycle.error = new RangeError("kept");
const copy = structuredClone(cycle);
console.log(
  copy !== cycle,
  copy.self === copy,
  copy.map.get("k").deep.join(),
  [...copy.set].join(),
  copy.date.toISOString(),
  String(copy.pattern),
  copy.big,
  copy.bytes.join(),
  copy.error instanceof RangeError,
  copy.error.message,
);
const buffer = new ArrayBuffer(8);
const moved = structuredClone(buffer, { transfer: [buffer] });
console.log(buffer.byteLength, moved.byteLength);
try {
  structuredClone(() => 1);
} catch (error) {
  console.log((error as Error).name);
}
