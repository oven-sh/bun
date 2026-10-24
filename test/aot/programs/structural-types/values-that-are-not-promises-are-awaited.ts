function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + value;
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

async function same<T>(value: T): Promise<boolean> {
  const awaited: unknown = await value;
  return Object.is(awaited, value);
}

async function show<T>(label: string, value: T): Promise<void> {
  const awaited = await value;
  console.log(label + ": " + text(awaited) + ", the same value " + (await same(value)));
}

function named(): number {
  return 1;
}

class Thing {
  then = "a text";
  other = 1;
}

const mark = Symbol("mark");

await show("a whole number", 1);
await show("minus zero", -0);
await show("not a number", NaN);
await show("a fraction", 0.5);
await show("a text", "text");
await show("an empty text", "");
await show("true", true);
await show("null", null);
await show("undefined", undefined);
await show("a bigint", 10n);
await show("a symbol", mark);
await show("a function", named);
await show("a class", Thing);
await show("an array", [1, 2]);
await show("an array of promises", [Promise.resolve(1)].length);
await show("an object", { x: 1 });
await show("then is a text", new Thing());
await show("then is null", { then: null });
await show("then is undefined", { then: undefined });
await show("then is an object", { then: {} });
await show("a date", new Date(0).getTime());
await show("a map", new Map([[1, 2]]).size);

async function sum(a: number, b: number): Promise<number> {
  return (await a) + (await b);
}
console.log("two awaited numbers: " + text(await sum(1, 2)));

async function order(): Promise<void> {
  const log: string[] = [];
  const one = (async () => {
    log.push("one starts");
    await 0;
    log.push("one after 1");
    await 0;
    log.push("one after 2");
  })();
  const two = (async () => {
    log.push("two starts");
    await undefined;
    log.push("two after 1");
    await "x";
    log.push("two after 2");
  })();
  const three = Promise.resolve().then(() => log.push("three 1")).then(() => log.push("three 2"));
  log.push("all started");
  await Promise.all([one, two, three]);
  console.log(log.join(", "));
}
await order();

let total = 0;
async function add(n: number): Promise<void> {
  total += await n;
}
for (let i = 0; i < 2000; i++) await add(1);
console.log("2000 awaited numbers: " + total);

export {};
