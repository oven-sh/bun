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

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

class Item {
  price = 5;
  name = "item";
  note?: string;
  total(count: number): number {
    return this.price * count;
  }
}

function spied<T extends object>(target: T): T {
  const handler = new Proxy<ProxyHandler<T>>({}, {
    get(_, trap) {
      log.push(String(trap));
      return undefined;
    },
  });
  return new Proxy(target, handler);
}

const uses: [string, (item: Item) => unknown][] = [
  ["a read", item => item.price],
  ["a store", item => (item.price = 6)],
  ["++", item => item.price++],
  ["a call", item => item.total(2)],
  ["in", item => "price" in item],
  ["delete", item => delete item.note],
  ["keys", item => Object.keys(item)],
  ["for-in", item => {
    let count = 0;
    for (const _ in item) count++;
    return count;
  }],
  ["JSON", item => JSON.stringify(item)],
  ["spread", item => Object.keys({ ...item })],
  ["rest", item => {
    const { price, ...others } = item;
    return [price, Object.keys(others)];
  }],
  ["Object.assign from it", item => Object.keys(Object.assign({}, item))],
  ["Object.assign onto it", item => Object.assign(item, { price: 1 }).price],
  ["instanceof", item => item instanceof Item],
  ["getPrototypeOf", item => Object.getPrototypeOf(item) === Item.prototype],
  ["setPrototypeOf", item => Object.setPrototypeOf(item, Item.prototype) === item],
  ["hasOwn", item => Object.hasOwn(item, "price")],
  ["defineProperty", item => Object.defineProperty(item, "price", { value: 1 }).price],
  ["freeze", item => Object.isFrozen(Object.freeze(item))],
  ["seal", item => Object.isSealed(Object.seal(item))],
  ["isExtensible", item => Object.isExtensible(item)],
  ["entries", item => Object.entries(item).length],
  ["String()", item => String(item)],
  ["a template", item => `${item}`],
  ["==", item => item == item],
  ["typeof", item => typeof item],
  ["a tag", item => Object.prototype.toString.call(item)],
  ["isArray", item => Array.isArray(item)],
  ["await", item => typeof Promise.resolve(item)],
  ["a key of a map", item => new Map([[item, 1]]).get(item)],
  ["a weak key", item => new WeakMap([[item, 1]]).get(item)],
];
for (const [, use] of uses) for (let i = 0; i < 300; i++) use(new Item());
console.log("after 300 honest items at every use");

for (const [name, use] of uses) logged(name, () => use(spied(new Item())));
logged("a function: called", () => spied((value: number) => value + 1)(1));
logged("a class: constructed", () => new (spied(Item))().price);
logged("an array: push", () => spied([1, 2]).push(3));
logged("an array: for-of", () => {
  let sum = 0;
  for (const value of spied([1, 2])) sum += value;
  return sum;
});
