console.table([
  { a: 1, b: "x" },
  { a: 2, b: "\u4f60\u597d" },
]);
console.table(new Map([["k", { v: 1 }]]));
console.log(Bun.inspect.table([{ a: 1 }], { colors: false }));
