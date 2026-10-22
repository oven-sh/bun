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

function sizeOf(map: Map<string, number>): number {
  return map.size;
}

function lookUp(map: Map<string, number>, key: string): number | undefined {
  return map.get(key);
}

function total(map: Map<string, number>): number {
  let sum = 0;
  for (const value of map.values()) sum += value;
  return sum;
}

function members(set: Set<number>): number[] {
  return [...set];
}

function time(date: Date): number {
  return date.getTime();
}

function sumBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum;
}

function firstByte(bytes: Uint8Array): number {
  return bytes[0];
}

function matches(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

function messageOf(error: Error): string {
  return error.message;
}

function upper(text: String): string {
  return text.toUpperCase();
}

function unbox(number: Number): number {
  return number.valueOf();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const map = new Map([["a", i]]);
  warm += sizeOf(map) + (lookUp(map, "a") ?? 0) + total(map) + members(new Set([i])).length + time(new Date(i)) + sumBytes(new Uint8Array([1, 2])) + firstByte(new Uint8Array([1]));
  warm += (matches(/a/, "a") ? 1 : 0) + messageOf(new Error("m")).length + upper(new String("a")).length + unbox(new Number(i));
}
console.log("after 2000 honest values", warm);

attempt("the size of a proxy of a map", () => sizeOf(new Proxy(new Map([["a", 1]]), {})));
attempt("get on a proxy of a map", () => lookUp(new Proxy(new Map([["a", 1]]), {}), "a"));
attempt("values of a proxy of a map", () => total(new Proxy(new Map([["a", 1]]), {})));
attempt("set on a proxy of a map", () => new Proxy(new Map<string, number>(), {}).set("a", 1).size);
attempt("typeof and instanceof of a proxy of a map", () => [typeof new Proxy(new Map(), {}), new Proxy(new Map(), {}) instanceof Map]);
attempt("a proxy of a map that binds methods to its target", () => {
  const target = new Map([["a", 1]]);
  const bound = new Proxy(target, {
    get(inner, key) {
      const member: unknown = Reflect.get(inner, key, inner);
      return typeof member === "function" ? member.bind(inner) : member;
    },
  });
  return [sizeOf(bound), lookUp(bound, "a"), total(bound)];
});
attempt("spread of a proxy of a set", () => members(new Proxy(new Set([1, 2]), {})));
attempt("has on a proxy of a set", () => new Proxy(new Set([1, 2]), {}).has(1));
attempt("getTime on a proxy of a date", () => time(new Proxy(new Date(5), {})));
attempt("a proxy of a date turned into a number", () => Number(new Proxy(new Date(5), {})));
attempt("JSON of a proxy of a date", () => JSON.stringify(new Proxy(new Date(5), {})));
attempt("the length of a proxy of bytes", () => new Proxy(new Uint8Array([1, 2]), {}).length);
attempt("the sum of a proxy of bytes", () => sumBytes(new Proxy(new Uint8Array([1, 2]), {})));
attempt("the first byte of a proxy of bytes", () => firstByte(new Proxy(new Uint8Array([7, 2]), {})));
attempt("a store into a proxy of bytes", () => {
  const target = new Uint8Array(2);
  const proxy = new Proxy(target, {});
  proxy[0] = 300;
  proxy[5] = 1;
  return [target[0], proxy[0], proxy[5], Object.keys(proxy)];
});
attempt("ArrayBuffer.isView of a proxy of bytes", () => ArrayBuffer.isView(new Proxy(new Uint8Array(1), {})));
attempt("test on a proxy of a regular expression", () => matches(new Proxy(/a/, {}), "a"));
attempt("replace with a proxy of a regular expression", () => "banana".replace(new Proxy(/a/g, {}), "o"));
attempt("the message of a proxy of an error", () => messageOf(new Proxy(new RangeError("far"), {})));
attempt("a proxy of an error is an error", () => [new Proxy(new RangeError("far"), {}) instanceof RangeError, String(new Proxy(new RangeError("far"), {}))]);
attempt("a thrown proxy of an error", () => {
  throw new Proxy(new RangeError("far"), {});
});
attempt("toUpperCase on a proxy of a String object", () => upper(new Proxy(new String("a"), {})));
attempt("the length of a proxy of a String object", () => new Proxy(new String("ab"), {}).length);
attempt("valueOf on a proxy of a Number object", () => unbox(new Proxy(new Number(5), {})));
attempt("deref on a proxy of a weak reference", () => new Proxy(new WeakRef({}), {}).deref());
attempt("next on a proxy of a generator", () => new Proxy((function* () { yield 1; })(), {}).next().value);
attempt("next on a proxy of an array iterator", () => new Proxy([1][Symbol.iterator](), {}).next().value);
attempt("byteLength of a proxy of a buffer", () => new Proxy(new ArrayBuffer(4), {}).byteLength);
attempt("structuredClone of a proxy", () => structuredClone(new Proxy({ a: 1 }, {})));

async function settle(promise: Promise<number>): Promise<string> {
  try {
    return "settled with " + (await promise);
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}
console.log("an honest promise -> " + (await settle(Promise.resolve(1))));
console.log("a proxy of a promise, awaited -> " + (await settle(new Proxy(Promise.resolve(1), {}))));
attempt("then on a proxy of a promise", () => typeof new Proxy(Promise.resolve(1), {}).then(value => value));
console.log("Promise.resolve of a proxy of a promise -> " + (await settle(Promise.resolve(new Proxy(Promise.resolve(1), {})))));

export {};
