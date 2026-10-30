import v8 from "node:v8";
console.log(
  typeof v8.getHeapStatistics().used_heap_size,
  (v8 as any).isStringOneByteRepresentation("abc"),
  (v8 as any).isStringOneByteRepresentation("\u20ac"),
  v8.deserialize(v8.serialize({ a: 1 })).a,
);
