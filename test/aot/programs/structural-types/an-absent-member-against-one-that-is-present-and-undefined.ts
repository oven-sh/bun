interface Options {
  name: string;
  limit?: number;
}

function facts(o: Options): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  const copy = { ...o };
  return [
    "reads " + o.limit,
    "in " + ("limit" in o),
    "hasOwnProperty " + o.hasOwnProperty("limit"),
    "hasOwn " + Object.hasOwn(o, "limit"),
    "keys " + Object.keys(o).join(),
    "for-in " + walked.join(),
    "json " + JSON.stringify(o),
    "entries " + Object.entries(o).join("|"),
    "values " + Object.values(o).length,
    "copy has it " + ("limit" in copy) + " " + Object.keys(copy).join(),
    "assign " + Object.keys(Object.assign({}, o)).join(),
    "descriptor " + (Object.getOwnPropertyDescriptor(o, "limit") !== undefined),
    "clone " + Object.keys(structuredClone(o)).join(),
  ].join("; ");
}

function has(o: Options): boolean {
  return "limit" in o;
}

function orDefault(o: Options): number {
  return o.limit ?? -1;
}

function patternDefault({ limit = -2 }: Options): number {
  return limit;
}

function make(kind: number): Options {
  if (kind === 0) return { name: "absent" };
  if (kind === 1) return { name: "undefined", limit: undefined };
  if (kind === 2) return { limit: undefined, name: "undefined first" };
  return { name: "present", limit: 0 };
}

class Holder {
  options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  has(): boolean {
    return "limit" in this.options;
  }
  keys(): string {
    return Object.keys(this.options).join();
  }
}

const absent: Options = { name: "absent" };
const present: Options = { name: "undefined", limit: undefined };

console.log("local, absent: " + ("limit" in absent) + " " + Object.keys(absent).join() + " " + JSON.stringify({ ...absent }));
console.log("local, undefined: " + ("limit" in present) + " " + Object.keys(present).join() + " " + Object.keys({ ...present }).join());
console.log("parameter, absent: " + facts(absent));
console.log("parameter, undefined: " + facts(present));
for (let kind = 0; kind < 4; kind++) console.log("result " + kind + ": " + facts(make(kind)));
for (let kind = 0; kind < 4; kind++) {
  const holder = new Holder(make(kind));
  console.log("field " + kind + ": " + holder.has() + " " + holder.keys());
}
const list: Options[] = [0, 1, 2, 3].map(make);
console.log("elements: " + list.map(has).join() + " " + JSON.stringify(list));
console.log("defaults: " + list.map(orDefault).join() + " " + list.map(patternDefault).join());
const captured = () => has(absent) + " " + has(present);
console.log("captured: " + captured());

let count = 0;
for (let i = 0; i < 2000; i++) if (has({ name: "n", limit: i })) count++;
console.log("2000 that have it: " + count);
console.log("then: " + has(absent) + " " + has(present) + " " + has({ name: "n", limit: 1 }));

count = 0;
for (let i = 0; i < 2000; i++) if (has({ name: "n" })) count++;
console.log("2000 that lack it: " + count);
console.log("then: " + has(present) + " " + has(absent));

const inherited: Options = Object.assign(Object.create({ limit: 9 }), { name: "inherited" });
console.log("on the prototype: " + facts(inherited));

const merged: Options = { ...{ name: "base", limit: 5 }, ...present };
console.log("undefined wins a merge: " + facts(merged));
const mergedAbsent: Options = { ...{ name: "base", limit: 5 }, ...absent };
console.log("absent does not: " + facts(mergedAbsent));

export {};
