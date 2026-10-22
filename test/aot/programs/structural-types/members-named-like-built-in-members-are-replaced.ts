class Rope {
  meters = 3;
  length(): number {
    return this.meters;
  }
  name(): string {
    return "rope";
  }
  call(): string {
    return "called";
  }
  apply(): string {
    return "applied";
  }
  bind(): string {
    return "bound";
  }
  push(n: number): number {
    return this.meters + n;
  }
  get size(): number {
    return this.meters * 2;
  }
  has(n: number): boolean {
    return n === this.meters;
  }
  at(i: number): number {
    return i;
  }
  static length = 7;
  static name = "a static name";
  static of(): string {
    return "static of";
  }
}

class Chain {
  links = 4;
  get length(): number {
    return this.links;
  }
  get name(): string {
    return "chain";
  }
}

function ropeFacts(r: Rope): string {
  return [r.length(), r.name(), r.call(), r.apply(), r.bind(), r.push(1), r.size, r.has(3), r.at(5)].join(" ");
}

function chainFacts(c: Chain): string {
  return c.length + " " + c.name;
}

function lengthOf(value: { length: number }): number {
  return value.length;
}

function staticFacts(): string {
  return Rope.length + " " + Rope.name + " " + Rope.of();
}

const r = new Rope();
const c = new Chain();

function round(label: string): void {
  console.log(label + ": " + ropeFacts(r) + " | " + chainFacts(c) + " " + lengthOf(c) + " " + lengthOf([1]) + " " + lengthOf("ab") + " | " + staticFacts());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += ropeFacts(r).length + chainFacts(c).length + lengthOf(c) + staticFacts().length;
console.log("2000 honest: " + warm);
round("before");

const written = { length: Rope.prototype.length, name: Rope.prototype.name, call: Rope.prototype.call, push: Rope.prototype.push, has: Rope.prototype.has, at: Rope.prototype.at };
Rope.prototype.length = () => -1;
Rope.prototype.name = () => "patched";
Rope.prototype.call = () => "patched call";
Rope.prototype.push = () => -2;
Rope.prototype.has = () => false;
Rope.prototype.at = () => -3;
round("the rope's methods replaced");

Object.assign(Rope.prototype, written);
round("put back");

r.length = () => -10;
r.apply = () => "own apply";
r.bind = () => "own bind";
round("own members");
for (const key of ["length", "apply", "bind"]) Reflect.deleteProperty(r, key);
round("removed");

Object.defineProperty(Chain.prototype, "length", { get: () => -4, configurable: true });
Object.defineProperty(c, "name", { value: "own name", configurable: true });
round("the chain's getters replaced and covered");

Rope.length = 70;
Rope.name = "another static name";
Rope.of = () => "replaced of";
round("the static members");

export {};
