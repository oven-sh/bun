// Typed code hands generic functions and a generic class objects of one class only. Untyped code calls the same functions with everything else and stores everything else into the field that they fill. Every call answers as in plain Bun, and typed code goes on as before.
interface Named {
  name: string;
}

class Item {
  name: string;
  count: number;

  constructor(name: string, count: number) {
    this.name = name;
    this.count = count;
  }
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  replace(value: T): T {
    const previous = this.value;
    this.value = value;
    return previous;
  }
}

function identity<T>(value: T): T {
  return value;
}

function nameOf<T extends Named>(value: T): string {
  return value.name;
}

function rename<T extends Named>(value: T, name: string): T {
  value.name = name;
  return value;
}

function choose<T>(useFirst: boolean, first: T, second: T): T {
  return useFirst ? first : second;
}

function apply<T, R>(value: T, change: (value: T) => R): R {
  return change(value);
}

function wrap<T>(value: T): Box<T> {
  return new Box(value);
}

function unwrap<T>(box: Box<T>): T {
  return box.value;
}

function nameInBox(box: Box<Item>): string {
  return box.value.name;
}

function countInBox(box: Box<Item>): number {
  const item = unwrap(box);
  return item.count;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol " + value.description;
  if (typeof value === "function") return "function " + value.name;
  if (value instanceof Item) return "Item " + show(value.name) + " " + show(value.count);
  if (value instanceof Box) return "Box(" + show(value.value) + ")";
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join() + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function typedRound(label: string): void {
  const item = new Item("typed", 1);
  const other = new Item("other", 2);
  const box = wrap(item);
  const answers = [
    identity(item).name,
    nameOf(item),
    rename(other, "renamed").name,
    choose(false, item, other).name,
    apply(item, value => value.count + 1),
    nameInBox(box),
    countInBox(box),
    unwrap(box).name,
    box.replace(other).name,
    box.get().count,
    nameInBox(new Box(other)),
  ];
  console.log(label + ":", answers.join(" "));
}

class Stranger {
  name = "stranger";
}

function named() {}

const loose: any = { identity, nameOf, rename, choose, apply, wrap, unwrap, nameInBox, countInBox, Box };

function makeStrangers(): any[] {
  const inherited = Object.create({ name: "inherited" });
  let uses = 0;
  const computed = {
    get name(): string {
      uses++;
      return "computed " + uses;
    },
    set name(value: string) {
      uses += 10;
    },
  };
  return [
    5,
    -0,
    0.5,
    NaN,
    "text",
    "",
    true,
    7n,
    Symbol("s"),
    undefined,
    null,
    { name: "plain" },
    { name: 9, more: 1 },
    {},
    JSON.parse('{"name":"parsed","count":8}'),
    inherited,
    computed,
    Object.freeze({ name: "frozen" }),
    new Stranger(),
    new Proxy({ name: "target" }, {}),
    [1, 2],
    named,
    new Item("an item after all", 6),
  ];
}

typedRound("before");

for (const stranger of makeStrangers()) {
  const answers = [
    attempt(() => loose.identity(stranger)),
    attempt(() => loose.nameOf(stranger)),
    attempt(() => loose.choose(true, stranger, 1)),
    attempt(() => loose.choose(false, new Item("first", 0), stranger)),
    attempt(() => loose.apply(stranger, (value: any) => typeof value)),
    attempt(() => loose.apply(1, stranger)),
    attempt(() => loose.wrap(stranger)),
    attempt(() => loose.unwrap(loose.wrap(stranger))),
    attempt(() => loose.unwrap(stranger)),
    attempt(() => loose.nameInBox(loose.wrap(stranger))),
    attempt(() => loose.nameInBox(stranger)),
    attempt(() => loose.countInBox(new loose.Box(stranger))),
  ];
  console.log(show(stranger) + ":", answers.join(" "));
}

for (const stranger of makeStrangers()) console.log("renamed", show(stranger) + ":", attempt(() => loose.rename(stranger, "new")), attempt(() => loose.nameOf(stranger)));

typedRound("after the calls");

for (const stranger of makeStrangers()) {
  const made: Box<Item> = loose.wrap(stranger);
  const filled = wrap(new Item("filled", 3));
  (filled as any).value = stranger;
  const replaced = wrap(new Item("replaced", 4));
  const before = loose.Box.prototype.replace.call(replaced, stranger);
  const answers = [
    attempt(() => nameInBox(made)),
    attempt(() => countInBox(made)),
    attempt(() => unwrap(made)),
    attempt(() => made.get()),
    attempt(() => nameInBox(filled)),
    attempt(() => filled.value),
    attempt(() => filled.replace(new Item("back", 5))),
    attempt(() => nameInBox(filled)),
    attempt(() => before),
    attempt(() => countInBox(replaced)),
    Object.keys(made).join(),
    Object.keys(filled).join(),
  ];
  console.log("stored", show(stranger) + ":", answers.join(" "));
}

const altered = wrap(new Item("altered", 7));
delete (altered as any).value;
console.log(attempt(() => nameInBox(altered)), attempt(() => unwrap(altered)), Object.keys(altered).length);
altered.value = new Item("stored again", 8);
console.log(nameInBox(altered), countInBox(altered), Object.keys(altered).join());
let reads = 0;
Object.defineProperty(altered, "value", {
  get() {
    reads++;
    return reads % 2 === 1 ? new Item("from a getter", reads) : reads;
  },
  configurable: true,
});
console.log(attempt(() => nameInBox(altered)), attempt(() => nameInBox(altered)), attempt(() => countInBox(altered)), attempt(() => countInBox(altered)), reads);

console.log(attempt(() => loose.nameOf()), attempt(() => loose.identity()), attempt(() => loose.wrap()), attempt(() => loose.choose()), attempt(() => loose.identity(1, 2, 3)));
console.log(attempt(() => Reflect.apply(nameOf, undefined, [{ name: "reflected" }])), attempt(() => (nameOf as any).call(null, 3)), attempt(() => [{ name: "mapped" }, "text", named].map(nameOf as any)));
console.log(attempt(() => Reflect.construct(Box, [4])), attempt(() => Reflect.construct(Box, [new Item("constructed", 9)])), attempt(() => loose.Box(1)));

let mixed = 0;
const typed = new Item("typed in a loop", 1);
for (let i = 0; i < 600; i++) {
  mixed += nameOf(typed).length + identity(typed).count;
  if (i % 3 === 0) mixed += loose.nameOf({ name: "ab" }).length + loose.identity(i);
  if (i % 5 === 0) mixed += loose.unwrap(loose.wrap(i)) + countInBox(wrap(typed));
}
console.log(mixed);

typedRound("at the end");

export {};
