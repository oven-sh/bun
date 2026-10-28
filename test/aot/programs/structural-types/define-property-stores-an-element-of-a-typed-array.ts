function byReflect(view: Float64Array): number {
  const before = view[1];
  Reflect.defineProperty(view, "1", { value: 9 });
  return before + view[1];
}

function byObject(view: Float64Array): number {
  const before = view[1];
  Object.defineProperty(view, "1", { value: 7 });
  return before + view[1];
}

console.log(byReflect(new Float64Array([0.5, 1.5])));
console.log(byReflect(new Float64Array([0.5, 2.5])));
console.log(byObject(new Float64Array([0.5, 1.5])));
console.log(byObject(new Float64Array([0.5, 2.5])));

export {};
