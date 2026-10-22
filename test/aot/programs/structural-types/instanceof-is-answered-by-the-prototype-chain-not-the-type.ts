class Bird {
  wings = 2;
  sing(): string {
    return "tweet";
  }
}

class Plane {
  wings = 2;
  sing(): string {
    return "roar";
  }
}

class Sparrow extends Bird {
  small = true;
}

function isBird(b: Bird): boolean {
  return b instanceof Bird;
}

function branch(b: Bird): string {
  if (b instanceof Bird) return "bird " + b.sing();
  return "not a bird";
}

function facts(b: Bird): string {
  return [
    isBird(b),
    branch(b),
    b.constructor.name,
    Bird.prototype.isPrototypeOf(b),
    Object.getPrototypeOf(b) === Bird.prototype,
    Bird[Symbol.hasInstance](b),
  ].join(" | ");
}

const relinked: Bird = new Bird();
const promoted: Bird = new Plane();
const bare: Bird = Object.create(Bird.prototype);
const literal: Bird = { wings: 2, sing: () => "literal" };
const nullProto: Bird = Object.assign(Object.create(null), { wings: 2, sing: () => "null prototype" });
const proxied: Bird = new Proxy(new Bird(), {});
const lyingProxy: Bird = new Proxy(new Plane(), { getPrototypeOf: () => Bird.prototype });

console.log("a bird: " + facts(new Bird()));
console.log("a sparrow: " + facts(new Sparrow()));
console.log("a plane: " + facts(new Plane()));
console.log("only the prototype: " + isBird(bare) + " " + branch(bare) + " " + bare.wings);
console.log("a literal: " + facts(literal));
console.log("no prototype: " + isBird(nullProto) + " " + branch(nullProto));
console.log("a proxy of a bird: " + facts(proxied));
console.log("a proxy that claims the prototype: " + isBird(lyingProxy) + " " + branch(lyingProxy));

console.log("before the prototype changes: " + facts(relinked));
Object.setPrototypeOf(relinked, Plane.prototype);
console.log("a bird relinked to Plane: " + facts(relinked));
console.log("before: " + facts(promoted));
Object.setPrototypeOf(promoted, Bird.prototype);
console.log("a plane relinked to Bird: " + facts(promoted));

let yes = 0;
for (let i = 0; i < 2000; i++) if (isBird(new Bird())) yes++;
console.log("2000 honest: " + yes);
console.log("then a plane: " + isBird(new Plane()) + ", a literal: " + isBird(literal) + ", a bird: " + isBird(new Bird()));

const flock: Bird[] = [new Bird(), new Plane(), new Sparrow(), literal, bare, relinked, promoted];
console.log("elements: " + flock.map(isBird).join());
console.log("filtered: " + flock.filter((b): b is Bird => b instanceof Bird).length);

class Club {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && "wings" in value;
  }
  wings = 0;
}

function inClub(c: Club): boolean {
  return c instanceof Club;
}

console.log("its own test, an instance: " + inClub(new Club()));
console.log("its own test, a bird: " + inClub(new Bird()));
console.log("its own test, anything: " + ({} instanceof Club) + " " + ({ wings: 1 } instanceof Club));

const originalPrototype = Object.getPrototypeOf(Sparrow.prototype);
const sparrow: Bird = new Sparrow();
console.log("a sparrow before: " + isBird(sparrow) + " " + sparrow.sing());
Object.setPrototypeOf(Sparrow.prototype, Plane.prototype);
console.log("its class relinked: " + isBird(sparrow) + " " + sparrow.sing() + " " + (sparrow instanceof Plane));
Object.setPrototypeOf(Sparrow.prototype, originalPrototype);
console.log("and back: " + isBird(sparrow) + " " + sparrow.sing());

export {};
