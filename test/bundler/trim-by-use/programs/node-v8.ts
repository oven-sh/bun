import v8 from "node:v8";
const thrownBy = (run: () => unknown) => {
  try {
    run();
    return "nothing";
  } catch (error: any) {
    return `${error.name}: ${error.message}`;
  }
};
console.log(
  typeof v8.getHeapStatistics().used_heap_size,
  (v8 as any).isStringOneByteRepresentation("abc"),
  (v8 as any).isStringOneByteRepresentation("\u20ac"),
  v8.deserialize(v8.serialize({ a: 1 })).a,
);
console.log(
  thrownBy(() => v8.serialize(() => {})),
  thrownBy(() => v8.deserialize(new Uint8Array(0))),
  thrownBy(() => v8.deserialize("text" as any)),
);
