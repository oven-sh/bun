// Typed functions, methods, constructors, async functions and generators are called with arguments, and with a `this`, of other types than they declare: no call is refused, and each runs as in plain Bun.
// STATISTIC: FunctionsWithTypesCheckedAtEntry >= 60
export {};

function show(label: string, run: () => unknown) {
  try {
    console.log(label, JSON.stringify(run()));
  } catch (error) {
    console.log(label, "threw", (error as Error).name, error instanceof RangeError ? error.message : "");
  }
}

async function showLater(label: string, run: () => unknown) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "rejected", (error as Error).name);
  }
}

function framesNamed(error: unknown, name: string): number {
  return (error as Error).stack!.split("\n").filter(line => line.includes(name)).length;
}

function describe(value: string, count: number): string {
  const tail = value.slice(count);
  return tail + value.length;
}

function validated(value: string): string {
  if (typeof value !== "string") throw new RangeError("not a string: " + typeof value);
  return value.toUpperCase();
}

function double(value: number): number {
  return value * 2;
}

function withDefault(value: number = 3, label: string = "x"): string {
  return label + value;
}

function collect(first: number, ...rest: number[]): string {
  return first + ":" + rest.join();
}

function counts(first: number, second: string): number {
  return arguments.length;
}

function listsArguments(first: number, second: string): unknown {
  return Array.from(arguments);
}

function counter(start: number, label: string): () => string {
  let current: number = start;
  return () => {
    current = current + 1;
    return label + current;
  };
}

function nested(value: number): () => () => string {
  const outer: number = value;
  return () => {
    const inner: number = outer;
    return () => typeof inner + ":" + inner;
  };
}

function literal(x: number, y: string): { x: number; y: string } {
  return { x, y };
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function callsTyped(value: number): number {
  return double(value) + 1;
}

function compare(left: number, right: number): number {
  return left - right;
}

function takesObject(point: { x: number }): number {
  return point.x;
}

function takesFunction(callback: (n: number) => number): number {
  return callback(2);
}

function takesArray(list: number[]): number {
  return list.length;
}

function takesUnion(value: string | number): string {
  return typeof value;
}

function takesBoolean(flag: boolean): string {
  return flag ? "yes" : "no";
}

function takesLiteral(mode: "on" | "off"): string {
  return mode === "on" ? "is on" : mode === "off" ? "is off" : "neither: " + String(mode);
}

enum Color {
  Red,
  Green,
}

function takesEnum(color: Color): unknown {
  return Color[color] ?? "none";
}

function takesBigInt(value: bigint): string {
  return typeof value + String(value);
}

function takesSymbol(value: symbol): string {
  return typeof value;
}

function takesNull(value: null): string {
  return typeof value + String(value);
}

function takesNever(value: never): string {
  return typeof value;
}

function takesTypeParameter<T extends number>(value: T): T {
  return value;
}

function takesAnyObject(value: object): string {
  return typeof value;
}

function takesTuple(pair: [number, string]): unknown {
  return pair[1];
}

function takesMap(map: Map<string, number>): unknown {
  return map.size;
}

function takesDate(date: Date): string {
  return typeof date.getTime;
}

function takesBytes(bytes: Uint8Array): unknown {
  return bytes.length;
}

function takesPromise(promise: Promise<number>): string {
  return typeof promise.then;
}

function takesPattern({ x, y }: { x: number; y: string }): string {
  return typeof x + ":" + typeof y;
}

function takesOptional(value?: number): string {
  return typeof value;
}

interface Shape {
  area(): number;
}

function takesInterface(shape: Shape): unknown {
  return shape.area();
}

class Meter {
  total: number = 0;
  add(amount: number): number {
    this.total = this.total + amount;
    return this.total;
  }
  adder(amount: number): () => number {
    return () => this.total + amount;
  }
  get half(): number {
    return this.total / 2;
  }
  set level(value: number) {
    this.total = value;
  }
  static scale(value: number): number {
    return value * 10;
  }
}

class SubMeter extends Meter {
  extra: number = 1;
}

class Other {
  total: string = "o";
}

function takesInstance(meter: Meter): unknown {
  return meter.total;
}

function usesThis(this: Meter, amount: number): unknown {
  return this.total + amount;
}

const account = {
  balance: 10,
  pay(amount: number): number {
    this.balance = this.balance - amount;
    return this.balance;
  },
};

class Point {
  x: number;
  label: string;
  constructor(x: number, label: string) {
    this.x = x;
    this.label = label;
  }
}

class Point3 extends Point {
  z: number;
  constructor(x: number, z: number) {
    super(x, "p3");
    this.z = z;
  }
}

class Pair {
  constructor(
    public first: number,
    readonly second: string = "s",
  ) {}
}

function Legacy(this: { size: number; made: string }, size: number) {
  this.size = size;
  this.made = typeof new.target;
}

async function later(value: number, label: string): Promise<string> {
  const doubled = value * 2;
  await null;
  return label + doubled;
}

const laterArrow = async (value: number): Promise<string> => typeof value;

class Service {
  prefix: string = "s";
  async load(id: number): Promise<string> {
    await null;
    return this.prefix + typeof id + id;
  }
}

const order: unknown[] = [];
async function ticks(name: string): Promise<void> {
  order.push(name + 1);
  await null;
  order.push(name + 2);
}

function* range(from: number, to: number): Generator<number, string, unknown> {
  for (let index = from; index < to; index++) yield index;
  return typeof from;
}

class Tree {
  leaves: number[] = [1, 2];
  *walk(scale: number): Generator<number> {
    for (const leaf of this.leaves) yield leaf * scale;
  }
}

async function* feed(count: number): AsyncGenerator<string> {
  for (let index = 0; index < count; index++) {
    await null;
    yield typeof count + index;
  }
}

function makeCounter(start: number, label: string) {
  return class Counter {
    static made: string = label;
    count: number = start;
    step(by: number): string {
      this.count = this.count + by;
      return label + this.count;
    }
  };
}

function makeSecret(seed: number) {
  class Base {
    constructor(public base: number) {}
  }
  return class Secret extends Base {
    #seed: number = seed;
    constructor(base: number) {
      super(base);
    }
    reveal(): string {
      return typeof this.#seed + ":" + this.#seed + ":" + typeof this.base + ":" + this.base;
    }
    static is(value: object): boolean {
      return #seed in value;
    }
  };
}

function evaluates(value: number, text: string): unknown {
  const local: number = value;
  return eval(text);
}

let lastAmount: number = 0;
function remember(amount: number): void {
  lastAmount = amount;
}
function recall(): string {
  return typeof lastAmount + ":" + lastAmount;
}

function makeStore(initial: number) {
  let held: number = initial;
  return {
    put(value: number): void {
      held = value;
    },
    get(): string {
      return typeof held + ":" + held;
    },
  };
}

function same(value: number): number {
  return value;
}
function usesResult(value: any): string {
  const result = same(value);
  return typeof result + ":" + result;
}

function readsPoint(point: Point): string {
  return typeof point.x + ":" + point.x + ":" + typeof point.label + ":" + point.label;
}

// The build cannot see through text that is put together at run time, so nothing is known of what comes out of this function.
const word: string = process.argv[2] ?? "w";
const unseen = new Function("value", "return value" + word.slice(word.length)) as (value: unknown) => any;
const untyped = unseen({
  describe,
  validated,
  double,
  withDefault,
  collect,
  counts,
  listsArguments,
  counter,
  nested,
  literal,
  factorial,
  callsTyped,
  takesObject,
  takesFunction,
  takesArray,
  takesUnion,
  takesBoolean,
  takesLiteral,
  takesEnum,
  takesBigInt,
  takesSymbol,
  takesNull,
  takesNever,
  takesTypeParameter,
  takesAnyObject,
  takesTuple,
  takesMap,
  takesDate,
  takesBytes,
  takesPromise,
  takesPattern,
  takesOptional,
  takesInterface,
  takesInstance,
  usesThis,
  account,
  Meter,
  Point,
  Point3,
  Pair,
  Legacy,
  later,
  laterArrow,
  Service,
  ticks,
  range,
  Tree,
  feed,
  makeCounter,
  makeSecret,
  evaluates,
  remember,
});

show("describe right", () => untyped.describe("hello", 2));
show("describe number", () => untyped.describe(5, 2));
show("describe array", () => untyped.describe([1, 2, 3], 1));
show("describe second", () => untyped.describe("hello", "2"));
show("describe object", () => untyped.describe({ slice: () => "s", length: 9 }, 0));
show("describe undefined", () => untyped.describe(undefined, 0));
show("describe none", () => untyped.describe());
show("validated right", () => untyped.validated("a"));
show("validated number", () => untyped.validated(7));
show("validated object", () => untyped.validated({}));
show("double right", () => untyped.double(4));
show("double string", () => untyped.double("4"));
show("double text", () => untyped.double("x"));
show("double bigint", () => String(untyped.double(4n)));
show("double object", () => untyped.double({ valueOf: () => 21 }));
show("double null", () => untyped.double(null));
show("double converts once", () => {
  let conversions = 0;
  const doubled = untyped.double({
    valueOf() {
      conversions++;
      return 2;
    },
  });
  return [doubled, conversions];
});
show("withDefault none", () => untyped.withDefault());
show("withDefault wrong", () => untyped.withDefault("7", 8));
show("withDefault undefined", () => untyped.withDefault(undefined, 8));
show("collect right", () => untyped.collect(1, 2, 3));
show("collect wrong", () => untyped.collect("a", "b", {}));
show("counts", () => [untyped.counts(), untyped.counts("a"), untyped.counts("a", 2, 3)]);
show("listsArguments", () => [untyped.listsArguments(), untyped.listsArguments("a", {}, 3)]);
show("counter right", () => {
  const next = untyped.counter(1, "n");
  return [next(), next()];
});
show("counter wrong", () => {
  const next = untyped.counter("1", 5);
  return [next(), next()];
});
show("nested right", () => untyped.nested(1)()());
show("nested wrong", () => untyped.nested("one")()());
show("literal right", () => untyped.literal(1, "a"));
show("literal wrong", () => untyped.literal("a", 1));
show("literal keys", () => Object.keys(untyped.literal({}, [])));
show("factorial right", () => untyped.factorial(5));
show("factorial string", () => untyped.factorial("5"));
show("callsTyped", () => [untyped.callsTyped(4), untyped.callsTyped("4"), untyped.callsTyped("x")]);
show("takesObject right", () => untyped.takesObject({ x: 1 }));
show("takesObject string", () => untyped.takesObject("text"));
show("takesObject number", () => untyped.takesObject(5));
show("takesObject null", () => untyped.takesObject(null));
show("takesObject proxy", () => {
  const traps: string[] = [];
  const handler: ProxyHandler<{ x: number }> = {
    get(target, key) {
      traps.push("get " + String(key));
      return Reflect.get(target, key);
    },
    has(target, key) {
      traps.push("has " + String(key));
      return Reflect.has(target, key);
    },
    getPrototypeOf(target) {
      traps.push("getPrototypeOf");
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      traps.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      traps.push("getOwnPropertyDescriptor " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  };
  return [untyped.takesObject(new Proxy({ x: 1 }, handler)), traps];
});
show("takesFunction right", () => untyped.takesFunction((n: number) => n + 1));
show("takesFunction number", () => untyped.takesFunction(3));
show("takesArray right", () => untyped.takesArray([1, 2]));
show("takesArray string", () => untyped.takesArray("four"));
show("takesArray object", () => untyped.takesArray({ length: 7 }));
show("takesUnion", () => [untyped.takesUnion("a"), untyped.takesUnion(1), untyped.takesUnion(true), untyped.takesUnion({})]);
show("takesBoolean", () => [untyped.takesBoolean(true), untyped.takesBoolean(0), untyped.takesBoolean("x"), untyped.takesBoolean(null)]);
show("takesLiteral", () => [untyped.takesLiteral("on"), untyped.takesLiteral("off"), untyped.takesLiteral("maybe"), untyped.takesLiteral(1)]);
show("takesEnum", () => [untyped.takesEnum(Color.Green), untyped.takesEnum(5), untyped.takesEnum("Red"), untyped.takesEnum({})]);
show("takesBigInt", () => [untyped.takesBigInt(1n), untyped.takesBigInt(1), untyped.takesBigInt("1")]);
show("takesSymbol", () => [untyped.takesSymbol(Symbol.iterator), untyped.takesSymbol("s"), untyped.takesSymbol()]);
show("takesNull", () => [untyped.takesNull(null), untyped.takesNull(undefined), untyped.takesNull(0), untyped.takesNull([])]);
show("takesNever", () => [untyped.takesNever(1), untyped.takesNever("s"), untyped.takesNever()]);
show("takesTypeParameter", () => [untyped.takesTypeParameter(1), untyped.takesTypeParameter("g"), untyped.takesTypeParameter([])]);
show("takesAnyObject", () => [untyped.takesAnyObject({}), untyped.takesAnyObject(() => 1), untyped.takesAnyObject(1), untyped.takesAnyObject("s")]);
show("takesTuple", () => [untyped.takesTuple([1, "a"]), untyped.takesTuple(["a", 1]), untyped.takesTuple("text"), untyped.takesTuple({ 1: "one" })]);
show("takesMap", () => [untyped.takesMap(new Map([["a", 1]])), untyped.takesMap(new Set([1, 2])), untyped.takesMap([]), untyped.takesMap({ size: "s" })]);
show("takesDate", () => [untyped.takesDate(new Date(0)), untyped.takesDate({}), untyped.takesDate(0)]);
show("takesBytes", () => [untyped.takesBytes(new Uint8Array(2)), untyped.takesBytes([1, 2, 3]), untyped.takesBytes("four"), untyped.takesBytes(5)]);
show("takesPromise", () => [untyped.takesPromise(Promise.resolve(1)), untyped.takesPromise({ then: 1 }), untyped.takesPromise(1)]);
show("takesPattern", () => [untyped.takesPattern({ x: 1, y: "a" }), untyped.takesPattern({ x: "a", y: 1 }), untyped.takesPattern(5)]);
show("takesPattern null", () => untyped.takesPattern(null));
show("takesOptional", () => [untyped.takesOptional(), untyped.takesOptional(1), untyped.takesOptional("s"), untyped.takesOptional(null)]);
show("takesInterface", () => [untyped.takesInterface({ area: () => 4 }), untyped.takesInterface({ area: () => "wide" })]);
show("takesInterface number", () => untyped.takesInterface(4));
show("takesInstance", () => [
  untyped.takesInstance(new Meter()),
  untyped.takesInstance(new SubMeter()),
  untyped.takesInstance(new Other()),
  untyped.takesInstance({ total: "made up" }),
  untyped.takesInstance(Object.create(Meter.prototype)),
  untyped.takesInstance("text"),
]);

show("method right", () => new untyped.Meter().add(2));
show("method wrong", () => new untyped.Meter().add("2"));
show("setter wrong", () => {
  const meter = new untyped.Meter();
  meter.level = "high";
  return meter.total;
});
show("static wrong", () => untyped.Meter.scale("3"));
show("static borrowed", () => untyped.Meter.scale.call(null, "3"));
show("method of a literal", () => [untyped.account.pay(1), untyped.account.pay("2"), untyped.account.pay.call({ balance: "100" }, "1")]);
show("borrowed method", () => untyped.Meter.prototype.add.call({ total: "t" }, "u"));
show("borrowed, right argument", () => untyped.Meter.prototype.add.call({ total: 1 }, 2));
show("borrowed by another class", () => {
  const other = new Other();
  return [untyped.Meter.prototype.add.call(other, 1), other];
});
show("borrowed by a subclass", () => {
  const sub = new SubMeter();
  return [untyped.Meter.prototype.add.call(sub, 2), sub];
});
show("borrowed by an heir of an instance", () => {
  const heir = Object.create(new Meter());
  return [untyped.Meter.prototype.add.call(heir, 2), Object.keys(heir)];
});
show("borrowed by an object with the prototype", () => {
  const bare = Object.create(Meter.prototype);
  return [bare.add(2), Object.keys(bare)];
});
show("borrowed by a proxy", () => untyped.Meter.prototype.add.call(new Proxy(new Meter(), {}), 2));
show("borrowed by a number", () => untyped.Meter.prototype.add.call(5, 1));
show("borrowed by a string", () => Reflect.apply(Meter.prototype.add, "text", [1]));
show("borrowed by null", () => untyped.Meter.prototype.add.call(null, 1));
show("borrowed without this", () => {
  const add = untyped.Meter.prototype.add;
  return add(1);
});
show("borrowed and bound", () => untyped.Meter.prototype.add.bind({ total: 1 })("2"));
show("borrowed getter", () => Object.getOwnPropertyDescriptor(Meter.prototype, "half")!.get!.call({ total: "8" }));
show("borrowed setter", () => {
  const target = { total: 0 };
  Object.getOwnPropertyDescriptor(Meter.prototype, "level")!.set!.call(target, "high");
  return target;
});
show("borrowed closure over this", () => untyped.Meter.prototype.adder.call({ total: "a" }, "b")());
show("borrowed, seen by the build", () => (Meter.prototype.add as any).call({ total: "t" }, "u"));
show("declared this", () => [untyped.usesThis.call(new Meter(), 1), untyped.usesThis.call({ total: "x" }, 1), untyped.usesThis.call("text", 1)]);
show("declared this missing", () => untyped.usesThis(1));

show("constructor right", () => new untyped.Point(1, "a"));
show("constructor wrong", () => new untyped.Point("1", 2));
show("constructor keys", () => Object.keys(new untyped.Point({}, [])));
show("constructor none", () => Object.entries(new untyped.Point()));
show("constructor instance", () => {
  const point = new untyped.Point("1", 2);
  return [point instanceof Point, Object.getPrototypeOf(point) === Point.prototype, point.constructor === Point];
});
show("constructor called", () => untyped.Point("1", 2));
show("constructor, seen by the build", () => new (Point as any)("1", 2));
show("derived right", () => new untyped.Point3(1, 2));
show("derived wrong", () => new untyped.Point3("x", "z"));
show("derived instance", () => {
  const point = new untyped.Point3("x", "z");
  return [point instanceof Point3, point instanceof Point, Object.keys(point)];
});
show("derived later", () => {
  class Late extends untyped.Point {
    constructor() {
      super("late", 0);
    }
  }
  const late = new Late();
  return [late, late instanceof Point];
});
show("parameter properties", () => [new untyped.Pair("f"), new untyped.Pair(1, 2), new untyped.Pair()]);
show("constructor function", () => [new untyped.Legacy("big"), new untyped.Legacy(1)]);
show("constructor function called", () => {
  const holder = {};
  untyped.Legacy.call(holder, "big");
  return holder;
});
show("Reflect.construct", () => Reflect.construct(Point, ["r", 1]));
show("Reflect.construct for another class", () => {
  const point = Reflect.construct(Point, ["r", 1], Point3);
  return [point, point instanceof Point3];
});

await showLater("async right", () => untyped.later(2, "n"));
await showLater("async wrong", () => untyped.later("3", 4));
await showLater("async rejects", () => untyped.later(Symbol(), "x"));
show("async never throws", () => {
  const promise = untyped.later(Symbol(), "x");
  promise.catch(() => {});
  return promise instanceof Promise;
});
await showLater("async arrow", () => Promise.all([untyped.laterArrow(1), untyped.laterArrow("1"), untyped.laterArrow()]));
await showLater("async method", () =>
  Promise.all([new untyped.Service().load(1), new untyped.Service().load("1"), untyped.Service.prototype.load.call({ prefix: 0 }, null)]),
);
await showLater("async order", async () => {
  untyped.ticks(1);
  untyped.ticks("b");
  order.push("after the calls");
  await null;
  await null;
  return order;
});
await showLater("async, seen by the build", () => (later as any)("3", 4));
show("async function object", () => [
  Object.prototype.toString.call(untyped.later),
  Object.getPrototypeOf(untyped.later) === Object.getPrototypeOf(async function () {}),
  "prototype" in untyped.later,
]);
show("async constructed", () => new untyped.later(1, "x"));

show("generator right", () => [...untyped.range(1, 4)]);
show("generator wrong", () => [...untyped.range("1", "3")]);
show("generator result", () => untyped.range("5", 0).next());
show("generator starts at next", () => typeof untyped.range(Symbol(), 1).next);
show("generator throws at next", () => untyped.range(Symbol(), 1).next());
show("generator object", () => {
  const numbers = untyped.range("a", "b");
  return [Object.getPrototypeOf(numbers) === range.prototype, numbers[Symbol.iterator]() === numbers, String(numbers)];
});
show("generator method", () => [
  [...new untyped.Tree().walk(2)],
  [...new untyped.Tree().walk("3")],
  [...untyped.Tree.prototype.walk.call({ leaves: "ab" }, 2)],
]);
show("generator, seen by the build", () => [...(range as any)("1", "3")]);
show("generator function object", () => [
  Object.prototype.toString.call(untyped.range),
  Object.getPrototypeOf(untyped.range) === Object.getPrototypeOf(function* () {}),
  typeof untyped.range.prototype,
]);
show("generator constructed", () => new untyped.range(1, 2));
await showLater("async generator", async () => {
  const items: unknown[] = [];
  for await (const item of untyped.feed(1)) items.push(item);
  for await (const item of untyped.feed("2")) items.push(item);
  return items;
});

show("class in a function right", () => {
  const Counter = untyped.makeCounter(1, "c");
  return [new Counter().step(2), Counter.made, Counter.name];
});
show("class in a function wrong", () => {
  const Counter = untyped.makeCounter("1", 5);
  return [new Counter().step(2), new Counter().step("2"), Counter.made, Counter.name];
});
show("class in a function, both", () => {
  const Right = untyped.makeCounter(1, "r");
  const Wrong = untyped.makeCounter("1", "w");
  return [
    new Wrong() instanceof Right,
    new Wrong() instanceof Wrong,
    Right.prototype.step.call(new Wrong(), 1),
    Wrong.prototype.step.call(new Right(), "1"),
  ];
});
show("class in a function, seen by the build", () => new ((makeCounter as any)("1", 5))().step(2));
show("private names right", () => {
  const Secret = untyped.makeSecret(1);
  const secret = new Secret(2);
  return [secret.reveal(), Secret.is(secret), Secret.is({})];
});
show("private names wrong", () => {
  const Secret = untyped.makeSecret("s");
  const secret = new Secret("b");
  return [secret.reveal(), Secret.is(secret), Secret.is({})];
});
show("private names, both", () => {
  const Right = untyped.makeSecret(1);
  const Wrong = untyped.makeSecret("1");
  return [Right.is(new Wrong(1)), Wrong.is(new Right(1)), Wrong.is(new Wrong("1")), Right.is(new Right("1"))];
});
show("private names of the other class", () => untyped.makeSecret(1).prototype.reveal.call(new (untyped.makeSecret("1"))(1)));
show("private name in a number", () => untyped.makeSecret(1).is(5));

show("eval right", () => untyped.evaluates(2, "value + local"));
show("eval wrong", () => untyped.evaluates("2", "value + local"));
show("eval of a number", () => untyped.evaluates(1, 5));
show("eval stores", () => untyped.evaluates("2", "value = [typeof value, typeof local]; value"));
show("eval closure", () => untyped.evaluates("2", "() => typeof value + local")());
show("eval, seen by the build", () => (evaluates as any)("2", "value + local"));

show("map", () => ["1", 2, null].map(double as any));
show("sort", () => [3, "1", 2, "10"].sort(compare as any));
show("cast call", () => (double as any)("8"));
show("apply", () => (describe as any).apply(null, [[4, 5, 6], 1]));
show("bound", () => (describe as any).bind(null, 12345)(1));
show("reflect", () => Reflect.apply(describe, null, [{ slice: () => 1, length: 2 }, 0]));
show("names", () => [describe.name, describe.length, withDefault.length, collect.length, typeof describe.toString()]);
show("names of the other kinds", () => [Point.name, Point.length, Pair.length, later.name, later.length, range.name, range.length, Meter.prototype.add.name]);
show("same function", () => [untyped.describe === describe, untyped.Point === Point, untyped.later === later, untyped.range === range]);
show("stack", () => {
  function thrower(value: number): number {
    return (value as any).missing.deeper;
  }
  try {
    (thrower as any)("text");
  } catch (error) {
    return framesNamed(error, "thrower");
  }
});
show("stack of a constructor", () => {
  class Thrower {
    constructor(value: number) {
      (value as any).missing.deeper;
    }
  }
  try {
    new (Thrower as any)("text");
  } catch (error) {
    return framesNamed(error, "Thrower");
  }
});
show("stack of a generator", () => {
  function* throwingGenerator(value: number): Generator<number> {
    yield (value as any).missing.deeper;
  }
  try {
    (throwingGenerator as any)("text").next();
  } catch (error) {
    return framesNamed(error, "throwingGenerator");
  }
});
await showLater("stack of an async function", async () => {
  async function throwingLater(value: number): Promise<number> {
    return (value as any).missing.deeper;
  }
  try {
    await (throwingLater as any)("text");
  } catch (error) {
    return framesNamed(error, "throwingLater");
  }
});

// Typed code reads what a call with arguments of other types has stored or returned.
show("method twice", () => {
  const meter = new untyped.Meter();
  meter.add("a");
  return [meter.add(1), typeof meter.total];
});
show("fields after the constructor", () => [readsPoint(new untyped.Point(1, "a")), readsPoint(new untyped.Point("1", 2)), readsPoint(new untyped.Point3({}, 0))]);
show("module variable", () => {
  untyped.remember("much");
  return recall();
});
show("module variable again", () => {
  untyped.remember(3);
  return [recall(), lastAmount + 1];
});
show("captured variable", () => {
  const store = makeStore(1);
  const before = store.get();
  (store as any).put("text");
  return [before, store.get()];
});
show("result", () => [usesResult(1), usesResult("s"), usesResult(null), usesResult({})]);
