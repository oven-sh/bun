const values = new Uint16Array([3, 1, 2]);
console.log(
  values.constructor.name,
  values.BYTES_PER_ELEMENT,
  values.sort().join(","),
  values.map((value: any) => value * 2).join(","),
);
console.log(
  Uint16Array.from([1, 2, 3]).filter((value: any) => value > 1).length,
  Uint16Array.of(4, 5).length,
  values.subarray(1).length,
  values.slice(1).length,
);
console.log(
  values.indexOf(2),
  values.includes(3),
  values.with(0, 9)[0],
  values.toSorted().join(""),
  values.toReversed().join(""),
  String(values.reduce((sum: any, value: any) => sum + value, 0)),
);
console.log(
  String(values.find((value: any) => value > 1)),
  values.findLastIndex((value: any) => value < 3),
  values.every((value: any) => value > 0),
  values.some((value: any) => value > 2),
  values.fill(7, 1, 2).join(","),
  values.copyWithin(0, 1).join(","),
  values.reverse().join(","),
);
values[1] = 5;
console.log(
  String(values[1]),
  1 in values,
  9 in values,
  Object.keys(values).join(""),
  Object.prototype.toString.call(values),
  [...values.entries()].length,
  delete (values as any)[9],
);
console.log(
  structuredClone(values).constructor.name,
  new Uint16Array(values.buffer, 0, 1).length,
  new Uint16Array(new ArrayBuffer(16, { maxByteLength: 32 })).length,
  new Uint16Array(values).join(","),
);
const bytes = new Uint8Array(values);
const back = new Uint16Array(4);
back.set(bytes, 1);
console.log(bytes.join(","), back.join(","), JSON.stringify(values), Math.max(...values));
Bun.gc(true);
