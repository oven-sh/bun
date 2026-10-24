function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Map<K, V> {
    firstKey(): K;
    capacity: number;
  }
  interface Set<T> {
    pick(): T;
    capacity: number;
  }
  interface Promise<T> {
    label: string;
    settled: boolean;
  }
  interface Date {
    quarter: number;
    tomorrow(): Date;
  }
  interface Error {
    status: number;
    retry(): boolean;
  }
  interface RegExp {
    hits: number;
  }
  interface Uint8Array {
    checksum: number;
    hex(): string;
  }
  interface Boolean {
    flipped: boolean;
  }
  interface Symbol {
    rank: number;
  }
  interface BigInt {
    digits: number;
  }
}

function statusOf(error: Error): number {
  return error.status;
}

function capacityOf(map: Map<string, number>): number {
  return map.capacity;
}

const map = new Map([["k", 1]]);
show("a map: the number", () => [map.capacity, capacityOf(map), capacityOf(map) + 1, map.size]);
show("a map: the method", () => map.firstKey());
show("a set: the number", () => [new Set([1]).capacity, new Set([1]).size]);
show("a set: the method", () => new Set([1]).pick());
show("a promise", () => [Promise.resolve(1).label, Promise.resolve(1).settled, Promise.resolve(1).settled === false]);
show("a date: the number", () => [new Date(0).quarter, new Date(0).quarter + 1, new Date(0).getTime()]);
show("a date: the method", () => new Date(0).tomorrow());
show("an error: the number", () => [new Error("e").status, statusOf(new RangeError("r")), statusOf(new Error("e")) + 1]);
show("an error: the method", () => new Error("e").retry());
show("an error that was caught", () => {
  try {
    null_();
    return "no error";
  } catch (error) {
    return error instanceof Error ? [error.status, typeof error.message] : "not an error";
  }
});
show("a regular expression", () => [/a/.hits, /a/.hits + 1, /a/.lastIndex]);
show("bytes: the number", () => [new Uint8Array(2).checksum, new Uint8Array(2).checksum + 1, new Uint8Array(2).length]);
show("bytes: the method", () => new Uint8Array(2).hex());
show("a boolean", () => [true.flipped, true.flipped === false, !true.flipped]);
show("a symbol", () => [Symbol.iterator.rank, Symbol.iterator.rank + 1]);
show("a bigint", () => [5n.digits, 5n.digits + 1]);

function null_(): void {
  throw new TypeError("thrown");
}

const failed = new Error("stored");
failed.status = 404;
let sum = 0;
for (let i = 0; i < 2000; i++) sum += statusOf(failed);
show("2000 reads of an error that has it", () => sum);
show("one that has not", () => [statusOf(new Error("e")), Object.keys(failed), Object.keys(new Error("e"))]);

export {};
