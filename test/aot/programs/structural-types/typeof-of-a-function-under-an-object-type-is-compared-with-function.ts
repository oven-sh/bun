type HasLength = { length: number };

function isFunction(item: HasLength): boolean {
  return typeof item === "function";
}

function two(first: number, second: number): number {
  return first + second;
}

console.log("zzliteral", isFunction({ length: 1 }));
console.log("zzfunction", isFunction(two));
console.log("zzclass", isFunction(class {}));
console.log("zztypeof", typeof two);
