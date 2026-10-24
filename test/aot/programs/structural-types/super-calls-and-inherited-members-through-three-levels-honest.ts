class Base {
  name = "instance";
  greet(): string {
    return "base(" + this.name + ")";
  }
  get rank(): number {
    return 1;
  }
  who(): string {
    return "who " + this.name;
  }
  static make(): string {
    return "base make by " + this.name;
  }
}

class Middle extends Base {
  greet(): string {
    return "middle(" + super.greet() + ")";
  }
  get rank(): number {
    return super.rank + 10;
  }
}

class Leaf extends Middle {
  greet(): string {
    return "leaf(" + super.greet() + ")";
  }
  viaArrow(): string {
    const inner = (): string => super.greet();
    return "arrow(" + inner() + ")";
  }
  static make(): string {
    return "leaf > " + super.make();
  }
}

class Quiet extends Middle {}

function greet(b: Base): string {
  return b.greet() + " " + b.rank + " " + b.who();
}

function leafGreet(l: Leaf): string {
  return l.greet() + " " + l.rank + " " + l.who();
}

function quietGreet(q: Quiet): string {
  return q.greet() + " " + q.rank + " " + q.who();
}

const leaf = new Leaf();
const quiet = new Quiet();

let warm = 0;
for (let i = 0; i < 2000; i++) warm += greet(leaf).length + leafGreet(leaf).length + quietGreet(quiet).length + leaf.viaArrow().length + Leaf.make().length + Quiet.make().length;
console.log("2000 rounds: " + warm);
console.log("typed as the base: " + [leaf, quiet, new Middle(), new Base()].map(greet).join(" | "));
console.log("typed as the leaf: " + leafGreet(leaf) + " | " + leaf.viaArrow());
console.log("typed as a subclass that overrides nothing: " + quietGreet(quiet));
console.log("static: " + [Leaf.make(), Quiet.make(), Middle.make(), Base.make()].join(" | "));
console.log("instanceof: " + (leaf instanceof Base) + " " + (quiet instanceof Leaf));

export {};
