console.log([{ a: 1, b: "x" }], new Map([["k", { v: 1 }]]));
console.group("g");
console.info("%s %d %o", "s", 1, { a: 1 });
console.groupEnd();
console.count("c");
console.error(new Set([1]));
