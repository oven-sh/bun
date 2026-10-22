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

class Vec {
  x: number;
  y: number;
  name = "vec";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
}

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

function total(v: Vec): number {
  return v.x + v.y;
}

function sumWhile(v: Vec, rounds: number, between: (round: number) => void): string {
  let sum = 0;
  let round = 0;
  try {
    for (; round < rounds; round++) {
      between(round);
      sum += v.x;
    }
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " in round " + round + " with " + sum;
  }
  return "finished with " + sum;
}

function twoReads(v: Vec, between: () => number): number {
  return v.x + between() + v.y;
}

function callAfter(v: Vec, between: () => void): number {
  const norm = v.norm;
  between();
  return norm.call(v);
}

async function acrossAnAwait(v: Vec, between: () => void): Promise<string> {
  const before = v.x;
  await Promise.resolve().then(between);
  try {
    return before + " " + v.x;
  } catch (error) {
    return before + " threw " + (error instanceof TypeError);
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(new Vec(i, 1)) + twoReads(new Vec(i, 1), () => 0) + callAfter(new Vec(3, 4), () => {});
console.log("after 2000 honest vectors", warm, sumWhile(new Vec(1, 1), 2000, () => {}));

attempt("before it is revoked", () => {
  const { proxy } = Proxy.revocable(new Vec(3, 4), {});
  return [total(proxy), proxy.norm(), typeof proxy];
});
attempt("in round 1500 of a loop", () => {
  const { proxy, revoke } = Proxy.revocable(new Vec(1, 1), {});
  return sumWhile(proxy, 3000, round => void (round === 1500 && revoke()));
});
attempt("between two reads of one expression", () => {
  const { proxy, revoke } = Proxy.revocable(new Vec(3, 4), {});
  return twoReads(proxy, () => (revoke(), 0));
});
attempt("between the read of a method and its call", () => {
  const { proxy, revoke } = Proxy.revocable(new Vec(3, 4), {});
  return callAfter(proxy, revoke);
});
attempt("by one of its own traps", () => {
  const pair = Proxy.revocable(new Vec(3, 4), {
    get(target, key, receiver) {
      if (key === "y") pair.revoke();
      return Reflect.get(target, key, receiver);
    },
  });
  return [total(pair.proxy), (() => { try { return total(pair.proxy); } catch { return "threw"; } })()];
});
attempt("what still works afterwards", () => {
  const { proxy, revoke } = Proxy.revocable(new Vec(3, 4), {});
  revoke();
  const list: Vec[] = [proxy];
  return [typeof proxy, proxy === list[0], list.includes(proxy), new Set(list).has(proxy), list.length];
});
const throwing: [string, (v: Vec) => unknown][] = [
  ["a read", v => v.x],
  ["a store", v => (v.x = 1)],
  ["a call", v => v.norm()],
  ["in", v => "x" in v],
  ["delete", v => Reflect.deleteProperty(v, "x")],
  ["keys", v => Object.keys(v)],
  ["instanceof", v => v instanceof Vec],
  ["isArray", v => Array.isArray(v)],
  ["JSON", v => JSON.stringify(v)],
  ["spread", v => ({ ...v })],
  ["String()", v => String(v)],
  ["a template", v => `${v}`],
  ["getPrototypeOf", v => Object.getPrototypeOf(v)],
  ["isFrozen", v => Object.isFrozen(v)],
  ["a proxy around it", v => typeof new Proxy(v, {})],
  ["a read through a proxy around it", v => new Proxy(v, {}).x],
  ["a read through a child of it", v => {
    const child: Vec = Object.create(v);
    return child.x;
  }],
];
for (const [name, use] of throwing) {
  attempt("revoked: " + name, () => {
    const { proxy, revoke } = Proxy.revocable(new Vec(3, 4), {});
    revoke();
    return use(proxy);
  });
}
{
  const { proxy, revoke } = Proxy.revocable(new Vec(3, 4), {});
  console.log("across an await -> " + (await acrossAnAwait(proxy, revoke)));
}
attempt("revoked twice", () => {
  const { revoke } = Proxy.revocable(new Vec(3, 4), {});
  revoke();
  revoke();
  return "fine";
});

export {};
