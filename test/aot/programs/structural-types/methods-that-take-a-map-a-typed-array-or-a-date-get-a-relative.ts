function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Wide {
  lookup(v: Map<string, number> | Set<string> | Record<string, number> | WeakMap<object, number>): number | undefined;
  size(v: Map<string, number> | Set<string> | Record<string, number> | WeakMap<object, number>): number;
  bytes(v: Uint8Array | number[] | Float64Array | string | DataView): number;
  firstByte(v: Uint8Array | number[] | Float64Array | string | DataView): number;
  sumBytes(v: Uint8Array | number[] | Float64Array | string | DataView): number;
  setByte(v: Uint8Array | number[] | Float64Array | string | DataView): string;
  year(v: Date | number | string | { getTime(): number }): number;
  stamp(v: Date | number | string | { getTime(): number }): number;
  test(v: RegExp | string | { source: string }): boolean;
  source(v: RegExp | string | { source: string }): string;
}

class Narrow implements Wide {
  lookup(m: Map<string, number>): number | undefined {
    return m.get("a");
  }
  size(m: Map<string, number>): number {
    return m.size;
  }
  bytes(u: Uint8Array): number {
    return u.byteLength;
  }
  firstByte(u: Uint8Array): number {
    return u[0];
  }
  sumBytes(u: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < u.length; i++) sum += u[i];
    return sum;
  }
  setByte(u: Uint8Array): string {
    u[0] = 300;
    return typeof u[0] + " " + u[0];
  }
  year(d: Date): number {
    return d.getUTCFullYear();
  }
  stamp(d: Date): number {
    return d.getTime();
  }
  test(r: RegExp): boolean {
    return r.test("abc");
  }
  source(r: RegExp): string {
    return r.source;
  }
}

const wide: Wide = new Narrow();

const maps: [string, Map<string, number> | Set<string> | Record<string, number> | WeakMap<object, number>][] = [
  ["map", new Map([["a", 1]])],
  ["set", new Set(["a"])],
  ["record", { a: 1, size: 9 }],
  ["weak map", new WeakMap()],
  ["subclass", new (class Loud extends Map<string, number> { get(key: string): number { return 42; } })()],
];
for (const [label, m] of maps) {
  show(label + " lookup", () => wide.lookup(m));
  show(label + " size", () => wide.size(m));
}

const buffers: [string, () => Uint8Array | number[] | Float64Array | string | DataView][] = [
  ["uint8", () => new Uint8Array([1, 2, 3])],
  ["array", () => [1, 2, 3]],
  ["float64", () => new Float64Array([1.5, 2.5])],
  ["string", () => "123"],
  ["data view", () => new DataView(new ArrayBuffer(4))],
  ["buffer", () => Buffer.from([4, 5, 6])],
  ["empty", () => new Uint8Array(0)],
];
for (const [label, make] of buffers) {
  show(label + " bytes", () => wide.bytes(make()));
  show(label + " firstByte", () => wide.firstByte(make()));
  show(label + " sumBytes", () => wide.sumBytes(make()));
  show(label + " setByte", () => wide.setByte(make()));
}

const dates: [string, Date | number | string | { getTime(): number }][] = [
  ["date", new Date(0)],
  ["number", 0],
  ["string", "1970"],
  ["look-alike", { getTime: () => 5 }],
  ["invalid date", new Date(NaN)],
];
for (const [label, d] of dates) {
  show(label + " year", () => wide.year(d));
  show(label + " stamp", () => wide.stamp(d));
}

const patterns: [string, RegExp | string | { source: string }][] = [
  ["regexp", /b/],
  ["string", "b"],
  ["look-alike", { source: "b" }],
];
for (const [label, r] of patterns) {
  show(label + " test", () => wide.test(r));
  show(label + " source", () => wide.source(r));
}
