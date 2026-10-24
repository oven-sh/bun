function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

function read(view: Float64Array, key: number): number {
  return view[key];
}

function readPlusOne(view: Float64Array, key: number): number {
  return view[key] + 1;
}

function write(view: Float64Array, key: number, value: number): void {
  view[key] = value;
}

function readInt(view: Int32Array, key: number): number {
  return view[key] | 0;
}

function readByte(view: Uint8Array, key: number): number {
  return view[key];
}

function state(view: Float64Array | Int32Array | Uint8Array): string {
  return "length " + view.length + ", keys " + Object.keys(view).join() + ", values " + Array.from(view).map(show).join();
}

let total = 0;
const warm = new Float64Array(3);
for (let i = 0; i < 2000; i++) {
  write(warm, i % 3, i / 2);
  total += read(warm, i % 3) + readPlusOne(warm, (i + 1) % 3) + readInt(new Int32Array([i]), 0) + readByte(new Uint8Array([i]), 0);
}
console.log("2000 honest rounds: " + total);

const keys = [1, 3, 99, -1, 1.5, -0, NaN, Infinity, -Infinity, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 53, 1e21];
for (const key of keys) {
  attempt("read " + show(key), () => {
    const view = new Float64Array([0.5, 1.5, 2.5]);
    return [typeof read(view, key), read(view, key), readPlusOne(view, key), key in view];
  });
  attempt("write " + show(key), () => {
    const view = new Float64Array([0.5, 1.5, 2.5]);
    write(view, key, 7);
    return [state(view), read(view, key)];
  });
  attempt("integers and bytes " + show(key), () => [readInt(new Int32Array([5, 6, 7]), key), typeof readByte(new Uint8Array([5, 6, 7]), key), readByte(new Uint8Array([5, 6, 7]), key)]);
}

const view = new Float64Array([0.5, 1.5]);
attempt("written out: reads", () => [view[2], view[-1], view[0.5], view[-0], view[NaN], view[4294967296], typeof view[2]]);
view[2] = 1;
view[-1] = 2;
view[0.5] = 3;
view[NaN] = 4;
view[-0] = 5;
console.log("written out: after five stores: " + state(view));
attempt("one past the end, summed", () => {
  let sum = 0;
  for (let i = 0; i <= view.length; i++) sum += view[i];
  return sum;
});
attempt("one past the end, summed as integers", () => {
  const ints = new Int32Array([1, 2]);
  let sum = 0;
  for (let i = 0; i <= ints.length; i++) sum += ints[i];
  return sum;
});
attempt("what is stored is converted", () => {
  const ints = new Int32Array(4);
  ints[0] = 1.9;
  ints[1] = 2 ** 31;
  ints[2] = NaN;
  ints[3] = -0;
  const bytes = new Uint8Array(3);
  bytes[0] = 256;
  bytes[1] = -1;
  bytes[2] = 1.9;
  const clamped = new Uint8ClampedArray(3);
  clamped[0] = 256;
  clamped[1] = -1;
  clamped[2] = 1.5;
  return [state(ints), state(bytes), Array.from(clamped)];
});
attempt("an empty one", () => [typeof new Float64Array(0)[0], new Float64Array(0)[0] + 1, new Int32Array(0)[0] | 0]);
attempt("at", () => [view.at(-1), view.at(99), view.at(-99), view.at(0.9), view.at(NaN)]);

export {};
