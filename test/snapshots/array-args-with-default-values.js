var lines;
const data = () => lines.map(([a = null, b = null, c = null, d = null]) => ({
  a,
  b,
  c,
  d
}));
export function test() {
  let ran = false;
  lines = [
    [undefined, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined],
    [undefined, undefined, undefined, undefined]
  ];
  for (let foo of data()) {
    console.assert(foo.a === null);
    console.assert(foo.b === null);
    console.assert(foo.c === null);
    console.assert(foo.d === null);
    ran = true;
  }
  console.assert(ran);
  testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/array-args-with-default-values.js.map
