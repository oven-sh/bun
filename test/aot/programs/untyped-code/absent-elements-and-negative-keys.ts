// `base[key]` on untyped values where the fast path finds no element: past the end of a string, in a String object that has its own elements, in a hole or past the end of an array that has named properties, under a negative key, which is a property name on an array and never a property of a typed array, and in an array that inherits elements.
function read(base: any, key: any): any { return base[key]; }
function store(base: any, key: any, value: any): void { base[key] = value; }
function show(value: unknown): string { return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function report(label: string, base: any, keys: unknown[]): void {
  console.log(label + ": " + keys.map(key => show(key) + " -> " + show(read(base, key))).join(", "));
}

const flat: any = "abc";
const rope: any = flat + String(flat.length) + "defghijklmnop";
const wide: any = "中文字";
for (const [label, text] of [["a string", flat], ["a rope", rope], ["a 16-bit string", wide]]) report(label, text, [0, 2, 3, 9, 100, -1, -2147483648, 2147483647, 4294967295, "9", "-1"]);

const boxed: any = new String("abc");
report("a String object", boxed, [0, 1, 2, 3, 10, -1]);
store(boxed, 10, 1);
report("with an element past its text", boxed, [0, 1, 2, 3, 9, 10, 11, -1]);
store(boxed, -1, "minus one");
try {
  store(boxed, 1, "refused");
} catch (error) {
  console.log("a store into its text throws", (error as Error).name);
}
report("with a negative name", boxed, [0, 1, 2, 10, -1, "-1"]);
console.log(Object.keys(boxed).join(), boxed.length, String(boxed));

const arrays: [string, () => any][] = [
  ["values", () => ["a", , "c"]],
  ["integers", () => [1, , 3]],
  ["doubles", () => [1.5, , 3.5]],
  ["nothing stored", () => new Array(3)],
  ["empty", () => []],
  ["sparse", () => { const sparse: any = [1, , 3]; sparse[100000] = "far"; return sparse; }],
];
const arrayKeys = [0, 1, 2, 3, 9, 100000, -1, -2, -2147483648, 4294967294, 4294967295, "1", "-1"];
for (const [label, create] of arrays) {
  report(label, create(), arrayKeys);

  const shadowing = create();
  shadowing.map = 1;
  report(label + ", map is an own property", shadowing, [...arrayKeys, "map"]);

  const named = create();
  named.foo = 1;
  report(label + ", foo is an own property", named, [...arrayKeys, "foo"]);

  const negative = create();
  store(negative, -1, "minus one");
  report(label + ", -1 is an own property", negative, arrayKeys);
  console.log(label + ":", negative.length, Object.keys(negative).join());
  delete negative[-1];
  report(label + ", -1 is deleted again", negative, [-1, "-1", 1]);

  const inheriting = create();
  Object.setPrototypeOf(inheriting, { __proto__: Array.prototype, 1: "inherited element", 9: "inherited past the end", "-1": "inherited name" });
  report(label + ", a prototype with elements", inheriting, arrayKeys);

  class Subclass extends Array {}
  const source = create();
  const instance: any = new Subclass();
  instance.length = source.length;
  for (const key in source) instance[key] = source[key];
  report(label + ", an instance of a subclass", instance, arrayKeys);
}

const typedArrays: [string, any][] = [
  ["Int8Array", new Int8Array([1, 2])],
  ["Uint8Array", new Uint8Array([1, 2])],
  ["Uint8ClampedArray", new Uint8ClampedArray([1, 2])],
  ["Int16Array", new Int16Array([1, 2])],
  ["Uint16Array", new Uint16Array([1, 2])],
  ["Int32Array", new Int32Array([1, 2])],
  ["Uint32Array", new Uint32Array([1, 2])],
  ["Float32Array", new Float32Array([1, 2])],
  ["Float64Array", new Float64Array([1, 2])],
  ["a part of a buffer", new Uint8Array(new Uint8Array([9, 1, 2, 9]).buffer, 1, 2)],
  ["over a resizable buffer", new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 }))],
  ["empty", new Uint8Array(0)],
];
const typedArrayKeys = [0, 1, 2, -1, -2, -2147483648, 4294967295, 4294967296, 1.5, "-1", "2", "-0"];
for (const [label, typedArray] of typedArrays) {
  report(label, typedArray, typedArrayKeys);
  for (const key of typedArrayKeys.slice(2)) store(typedArray, key, 7);
  report(label + ", after stores outside", typedArray, typedArrayKeys);
  console.log(label + ":", Object.keys(typedArray).join(), Array.from(new Uint8Array(typedArray.buffer)).join());
}
