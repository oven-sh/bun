const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);

function five(a?: number, b?: number, c?: number, d?: number, e?: number) {
  return [a, b, c, d, e].map(value => (value === undefined ? "-" : String(value))).join("");
}
const loose = five as (...values: number[]) => string;
say("fewer and more arguments than parameters", [
  loose(),
  loose(1),
  loose(1, 2, 3),
  loose(1, 2, 3, 4, 5, 6, 7),
  Reflect.apply(five, null, [9]),
  new (function Made(this: { n: number }, a?: number, b?: number) {
    this.n = (a ?? 1) + (b ?? 2);
  } as unknown as new (a?: number) => { n: number })(5).n,
]);

class Animal {
  legs() {
    return 4;
  }
  get name() {
    return "animal";
  }
}
class Dog extends Animal {}
class Puppy extends Dog {}
const puppies = Array.from({ length: 50 }, () => new Puppy());
let legs = 0;
for (let round = 0; round < 2000; round++) for (const puppy of puppies) legs += puppy.legs() + puppy.name.length;
say("read through two prototypes", legs);
(Dog.prototype as unknown as { legs(): number }).legs = () => 3;
Object.defineProperty(Animal.prototype, "name", { get: () => "beast!" });
legs = 0;
for (let round = 0; round < 2000; round++) for (const puppy of puppies) legs += puppy.legs() + puppy.name.length;
say("after the prototypes changed", legs);
Object.setPrototypeOf(Puppy.prototype, Animal.prototype);
say("after the chain changed", puppies[0]!.legs());

const lists: unknown[][] = [[1, 2, 3], [1.5, 2.5], ["a", 1, null], [], new Array(5), Array.from({ length: 3 })];
let total = 0;
for (let round = 0; round < 3000; round++) {
  const list = lists[round % lists.length]!;
  list.push(round % 3 === 0 ? round : round % 3 === 1 ? round + 0.5 : "s" + round);
  total += list.length;
  if (list.length > 40) list.length = 2;
}
say("arrays that change their kind", total);

function thrower(kind: number): never {
  if (kind === 0) throw new TypeError("zero");
  if (kind === 1) throw "a string";
  throw { kind };
}
const caught: string[] = [];
for (let round = 0; round < 900; round++) {
  try {
    thrower(round % 3);
  } catch (error) {
    if (round < 3)
      caught.push(typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error));
  }
}
say("caught", caught);
say("host functions as values", [
  [3, 1, 2].map(Math.sqrt).map(Math.round),
  ["b", "a"].sort().map(String),
  [1, 2].map(Number.isInteger as (value: number) => boolean),
  [" x "].map(Function.prototype.call, String.prototype.trim),
]);

const functions: (() => number)[] = [];
for (let round = 0; round < 8; round++) {
  for (let at = 0; at < 3000; at++) functions[at % 700] = () => at + round;
  Bun.gc(true);
  total += functions[round]!();
  Bun.gc(false);
}
say("sixteen collections with live closures", total);
console.log(lines.join("\n"));
