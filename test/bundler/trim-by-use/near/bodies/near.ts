console.log(
  "no body",
  JSON.stringify({ a: 1 }),
  new Uint8Array([1, 2, 3]),
  new ArrayBuffer(4).byteLength,
  typeof structuredClone,
);
console.log({
  nested: {
    map: new Map([[1, 2]]),
    set: new Set([1]),
    date: new Date(0),
    error: new RangeError("r"),
    fn() {},
    symbol: Symbol("s"),
    big: 1n,
    re: /x/g,
    cls: new (class Point {
      x = 1;
    })(),
  },
});
try {
  // @ts-ignore
  await import("blob:nothing");
} catch (error: any) {
  console.log(error.name);
}
