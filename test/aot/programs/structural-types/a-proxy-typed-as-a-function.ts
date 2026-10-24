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

type Unary = (value: number) => number;

function double(value: number): number {
  return value * 2;
}

function watched(target: Unary): Unary {
  return new Proxy(target, {
    apply: (inner, self, list) => (log.push("apply:" + typeof self + ":" + list.join()), Reflect.apply(inner, self, list)),
    get: (inner, key, receiver) => (log.push("get:" + String(key)), Reflect.get(inner, key, receiver)),
  });
}

function callIt(f: Unary, value: number): number {
  return f(value);
}

function callTwice(f: Unary, value: number): number {
  return f(f(value));
}

function callInALoop(f: Unary): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += f(i);
  return total;
}

class Tool {
  constructor(public run: Unary) {}
  use(value: number): number {
    return this.run(value);
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += callIt(double, i) + callTwice(double, i) + callInALoop(double) + new Tool(double).use(i);
console.log("after 2000 honest calls", warm);

logged("called", () => callIt(watched(double), 4));
logged("called twice", () => callTwice(watched(double), 4));
logged("called in a loop", () => callInALoop(watched(double)));
logged("as a field", () => new Tool(watched(double)).use(4));
logged("call", () => watched(double).call(undefined, 4));
logged("apply", () => watched(double).apply(undefined, [4]));
logged("bind", () => watched(double).bind(undefined, 4)());
logged("Reflect.apply", () => Reflect.apply(watched(double), undefined, [4]));
logged("handed to map", () => [1, 2].map(watched(double)));
logged("handed to Array.from", () => Array.from([1, 2], watched(double)));
logged("as a reaction, later", () => "see the last line");
logged("typeof, name, length", () => [typeof watched(double), watched(double).name, watched(double).length]);
logged("instanceof Function", () => watched(double) instanceof Function);
logged("without an apply trap", () => callIt(new Proxy(double, {}), 4));
logged("an apply trap that answers a string", () => callIt(new Proxy(double, { apply: () => "four" }), 4) + 1);
logged("an apply trap that answers nothing", () => callIt(new Proxy(double, { apply: () => undefined }), 4) + 1);
logged("an apply trap that throws", () => callIt(new Proxy(double, { apply: () => { throw new RangeError("no"); } }), 4));
logged("an apply trap that changes the argument", () => callIt(new Proxy(double, { apply: (inner, self, list) => inner(list[0] + 1) }), 4));
logged("a revoked function", () => {
  const { proxy, revoke } = Proxy.revocable(double, {});
  const before = callIt(proxy, 4);
  revoke();
  return [before, typeof proxy, callIt(proxy, 4)];
});
logged("a proxy of an arrow function is constructed", () => Reflect.construct(new Proxy((value: number) => value, {}), [1]));
logged("a proxy of a bound function", () => callIt(watched(double.bind(null)), 4));
logged("a proxy of a proxy", () => callIt(watched(watched(double)), 4));
logged("a proxy of a method keeps no this", () => {
  const counter = { step: 2, add(value: number) { return value + this.step; } };
  const add: Unary = new Proxy(counter.add, {});
  return add(1);
});
logged("honest again", () => [callIt(double, 4), callTwice(double, 4)]);
console.log("as a reaction -> " + (await Promise.resolve(4).then(watched(double))));

export {};
