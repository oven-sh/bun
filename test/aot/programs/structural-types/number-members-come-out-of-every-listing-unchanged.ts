interface Reading {
  a: number;
  b: number;
}

class Sample {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
}

function text(value: unknown): string {
  if (typeof value !== "number") return typeof value;
  return Object.is(value, -0) ? "-0" : String(value);
}

function byKey(r: Reading, key: keyof Reading): number {
  return r[key];
}

function everyWay(r: Reading): string {
  const walked: string[] = [];
  for (const key in r) walked.push(text(Reflect.get(r, key)));
  const { a, ...rest } = r;
  const copy = { ...r };
  return [
    "direct " + text(r.a) + " " + text(r.b),
    "by key " + text(byKey(r, "a")) + " " + text(byKey(r, "b")),
    "values " + Object.values(r).map(text).join(" "),
    "entries " + Object.entries(r).map(([, value]) => text(value)).join(" "),
    "for-in " + walked.join(" "),
    "copy " + text(copy.a) + " " + text(copy.b),
    "rest " + text(a) + " " + text(rest.b),
    "assign " + text(Object.assign({ a: 0, b: 0 }, r).b),
    "clone " + text(structuredClone(r).a) + " " + text(structuredClone(r).b),
    "descriptor " + text(Object.getOwnPropertyDescriptor(r, "b")?.value),
    "json " + JSON.stringify(r),
    "list " + [r.a, r.b].map(text).join(" "),
    "text " + `${r.a} ${r.b}`,
  ].join("; ");
}

const numbers = [0, -0, 1, -1, 0.1, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 4294967296, 1e21, 5e-324, 9007199254740993];

for (const n of numbers) {
  console.log(text(n) + ", a literal: " + everyWay({ a: n, b: n }));
  console.log(text(n) + ", an instance: " + everyWay(new Sample(n, n)));
}

const changing: Reading = { a: 1, b: 2 };
const instance = new Sample(1, 2);
for (const n of numbers) {
  changing.b = n;
  instance.b = n;
  console.log("stored " + text(n) + ": " + Object.values(changing).map(text).join(" ") + " | " + Object.values(instance).map(text).join(" ") + " | " + JSON.stringify([changing, instance]));
}

const nan1: Reading = { a: NaN, b: 0 / 0 };
const bits = new Float64Array([nan1.a, nan1.b, -nan1.a, Math.sqrt(-1)]);
console.log("every not-a-number is one: " + Array.from(bits).map(text).join(" ") + " " + Object.is(nan1.a, nan1.b) + " " + (nan1.a === nan1.b) + " " + [nan1.a].includes(nan1.b) + " " + [nan1.a].indexOf(nan1.b));

const odd = new Float64Array(new BigUint64Array([0xfff8000000000001n, 0x7ff0000000000001n, 0xffffffffffffffffn]).buffer);
const carried: Reading[] = Array.from(odd, n => ({ a: n, b: n }));
console.log("unusual bit patterns read from memory: " + carried.map(r => everyWay(r).length + ":" + text(r.a) + ":" + typeof r.b).join(" "));
const carriedInstances = Array.from(odd, n => new Sample(n, n));
console.log("in instances: " + carriedInstances.map(r => text(r.a) + ":" + Object.values(r).map(text).join("/")).join(" "));

export {};
