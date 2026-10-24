function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

function double(n: number): number {
  return n * 2;
}
function greet(this: { name: string } | void, word: string): string {
  return word + " " + (this ? this.name : "nobody");
}

const silent = new Proxy(double, {});
const logged = new Proxy(double, {
  apply(target, thisArg, args) {
    log.push("apply " + args.length + " " + typeof thisArg);
    return Reflect.apply(target, thisArg, args);
  },
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});
const liar = new Proxy(double, {
  apply() {
    return "not a number";
  },
});
const thrower = new Proxy(double, {
  apply() {
    throw new RangeError("no");
  },
});
const nested = new Proxy(new Proxy(double, {}), {});
const { proxy: revocable, revoke } = Proxy.revocable(double, {});

function run(f: (n: number) => number, n: number): number {
  return f(n);
}
function runPlusOne(f: (n: number) => number, n: number): number {
  return f(n) + 1;
}

const all: [string, (n: number) => number][] = [
  ["plain", double],
  ["silent", silent],
  ["logged", logged],
  ["liar", liar],
  ["thrower", thrower],
  ["nested", nested],
  ["revocable", revocable],
];

for (const [label, f] of all) {
  show(label + " typeof", () => typeof f);
  show(label + " run", () => run(f, 4));
  show(label + " run plus one", () => runPlusOne(f, 4));
  show(label + " call", () => f.call(undefined, 4));
  show(label + " apply", () => f.apply(undefined, [4]));
  show(label + " bind", () => f.bind(undefined, 4)());
  show(label + " map", () => [1, 2].map(f));
  show(label + " name", () => f.name);
  show(label + " length", () => f.length);
}
show("log", () => log.join(" | "));

revoke();
show("revoked typeof", () => typeof revocable);
show("revoked run", () => run(revocable, 4));
show("revoked name", () => revocable.name);

const proxiedGreet = new Proxy(greet, {});
const holder = { name: "holder", greet: proxiedGreet };
show("this passes through a proxy", () => holder.greet("hello"));
show("bare", () => proxiedGreet("hello"));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += run(double, 1);
show("2000 plain calls", () => sum);
show("then the liar", () => run(liar, 1));
show("then the liar plus one", () => runPlusOne(liar, 1));
show("then plain", () => run(double, 1));

const numbers: number[] = [];
numbers.push(run(liar, 1), run(double, 1));
show("stored in a number[]", () => numbers.map(n => typeof n).join());
show("added", () => numbers[0] + numbers[1]);
