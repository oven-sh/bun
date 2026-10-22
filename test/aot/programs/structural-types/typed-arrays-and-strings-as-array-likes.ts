function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function sum(list: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function first(list: ArrayLike<number>): number {
  return list[0];
}

function pastTheEnd(list: ArrayLike<number>): unknown[] {
  return [list[list.length], typeof list[list.length], list.length in list, list[-1]];
}

function halves(list: ArrayLike<number>): number[] {
  const result: number[] = [];
  for (let i = 0; i < list.length; i++) result.push(list[i] / 2);
  return result;
}

function kinds(list: ArrayLike<number>): string {
  let text = "";
  for (let i = 0; i < list.length; i++) text += typeof list[i] + " ";
  return text;
}

function letters(list: ArrayLike<string>): string {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i].toUpperCase() + ".";
  return text;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [i, 2, 3];
  warm += sum(honest) + first(honest) + pastTheEnd(honest).length + halves(honest)[0] + kinds(honest).length + letters(["a", "b"]).length;
}
console.log("after 2000 arrays", warm);

const makers: [string, () => ArrayLike<number>][] = [
  ["an array of integers", () => [1, 2, 3]],
  ["an array of doubles", () => [1.5, 2.5, -0]],
  ["Int8Array", () => new Int8Array([-128, 127, 1])],
  ["Uint8Array", () => new Uint8Array([255, 0, 1])],
  ["Uint8ClampedArray", () => new Uint8ClampedArray([300, -5, 1.5])],
  ["Int16Array", () => new Int16Array([-32768, 32767])],
  ["Uint16Array", () => new Uint16Array([65535, 1])],
  ["Int32Array", () => new Int32Array([-2147483648, 2147483647])],
  ["Uint32Array", () => new Uint32Array([4294967295, 2147483648])],
  ["Float32Array", () => new Float32Array([0.1, -0, NaN])],
  ["Float64Array", () => new Float64Array([0.1, -0, NaN, Infinity])],
  ["Float16Array", () => new Float16Array([0.1, 65504])],
  ["an empty typed array", () => new Float64Array(0)],
  ["a view into the middle of a buffer", () => new Uint8Array(new Uint8Array([1, 2, 3, 4]).buffer, 1, 2)],
  ["a buffer", () => Buffer.from([7, 8])],
  ["a literal", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a literal that is too short", () => ({ 0: 1, length: 2 })],
];
for (const [name, make] of makers) {
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": first", () => first(make()));
  attempt(name + ": past the end", () => pastTheEnd(make()));
  attempt(name + ": halves", () => halves(make()));
  attempt(name + ": kinds", () => kinds(make()));
}
attempt("an array again", () => [sum([1, 2, 3]), first([4]), halves([1])]);
attempt("letters of an array", () => letters(["a", "b"]));
attempt("letters of a string", () => letters("ab"));
attempt("letters of an empty string", () => letters(""));
attempt("letters of a String object", () => letters(new String("ab")));
attempt("letters of a literal that is too short", () => letters({ 0: "a", length: 2 }));
attempt("a detached typed array", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const before = sum(bytes);
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  return [before, bytes.length, sum(bytes), first(bytes)];
});
attempt("a typed array over a buffer that shrinks", () => {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const bytes = new Uint8Array(buffer);
  bytes.set([1, 2, 3, 4]);
  const before = sum(bytes);
  buffer.resize(2);
  return [before, bytes.length, sum(bytes), pastTheEnd(bytes)];
});
