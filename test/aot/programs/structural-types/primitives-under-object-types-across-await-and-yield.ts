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

type HasLength = { length: number };

async function afterAnAwait(item: HasLength): Promise<number> {
  await null;
  return item.length;
}

async function beforeAndAfter(item: HasLength): Promise<string> {
  const before = item.length;
  await Promise.resolve();
  const kind = typeof item;
  await Promise.resolve();
  return before + " " + kind + " " + item.length;
}

async function awaited(promise: Promise<HasLength>): Promise<number> {
  const item = await promise;
  return item.length;
}

async function awaitedItself(item: HasLength | Promise<HasLength>): Promise<string> {
  const settled = await item;
  return typeof settled + " " + settled.length;
}

async function total(items: HasLength[]): Promise<number> {
  let sum = 0;
  for (const item of items) {
    await null;
    sum += item.length;
  }
  return sum;
}

function* lengths(items: HasLength[]): Generator<number, string, HasLength> {
  let answer = "";
  for (const item of items) {
    const sent = yield item.length;
    answer += typeof sent + sent.length + " " + typeof item + item.length + ";";
  }
  return answer;
}

function* hand(items: HasLength[]): Generator<HasLength> {
  for (const item of items) yield item;
}

async function* handLater(items: HasLength[]): AsyncGenerator<HasLength> {
  for (const item of items) {
    await null;
    yield item;
  }
}

const values: [string, HasLength][] = [
  ["literal", { length: 4 }],
  ["string", "hello"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function", awaited],
];

let warm = 0;
for (let i = 0; i < 500; i++) {
  const honest = { length: i };
  warm += (await afterAnAwait(honest)) + (await beforeAndAfter(honest)).length + (await awaited(Promise.resolve(honest))) + (await total([honest, honest]));
}
console.log("after 500 literals", warm);

for (const [name, value] of values) {
  console.log(name + ": after an await ->", show(await afterAnAwait(value)));
  console.log(name + ": before and after ->", show(await beforeAndAfter(value)));
  console.log(name + ": the value of a promise ->", show(await awaited(Promise.resolve(value))));
  console.log(name + ": awaited itself ->", show(await awaitedItself(value)));
  console.log(name + ": then ->", show(await Promise.resolve(value).then(item => item.length)));
}
const all = values.map(([, value]) => value);
console.log("total ->", show(await total(all)));
console.log("Promise.all ->", show((await Promise.all(all.map(item => Promise.resolve(item)))).map(item => typeof item + item.length)));

attempt("sent into a generator", () => {
  const generator = lengths(all);
  const seen: unknown[] = [generator.next("unused").value];
  for (const value of ["sent", [1], { length: 9 }, "", lengths] satisfies HasLength[]) seen.push(generator.next(value).value);
  return seen;
});
attempt("handed out by a generator", () => {
  let sum = 0;
  for (const item of hand(all)) sum += item.length;
  return sum;
});
let sumLater = "";
for await (const item of handLater(all)) sumLater += typeof item + item.length + ";";
console.log("handed out by an async generator ->", sumLater);

export {};
