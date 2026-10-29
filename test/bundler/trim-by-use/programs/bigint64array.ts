const values = new BigInt64Array([3n, 1n, 2n]);
console.log(
  values.constructor.name,
  values.BYTES_PER_ELEMENT,
  values.sort().join(","),
  values.map((value: any) => value * 2n).join(","),
);
console.log(
  BigInt64Array.from([1n, 2n, 3n]).filter((value: any) => value > 1n).length,
  BigInt64Array.of(4n, 5n).length,
  values.subarray(1).length,
  values.slice(1).length,
);
console.log(
  values.indexOf(2n),
  values.includes(3n),
  values.with(0, 9n)[0],
  values.toSorted().join(""),
  values.toReversed().join(""),
  String(values.reduce((sum: any, value: any) => sum + value, 0n)),
);
console.log(
  String(values.find((value: any) => value > 1n)),
  values.findLastIndex((value: any) => value < 3n),
  values.every((value: any) => value > 0n),
  values.some((value: any) => value > 2n),
  values.fill(7n, 1, 2).join(","),
  values.copyWithin(0, 1).join(","),
  values.reverse().join(","),
);
values[1] = 5n;
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
  new BigInt64Array(values.buffer, 0, 1).length,
  new BigInt64Array(new ArrayBuffer(16, { maxByteLength: 32 })).length,
  new BigInt64Array(values).join(","),
);
Bun.gc(true);
