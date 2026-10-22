class Base {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  who(): string {
    return "base " + this.id;
  }
  get rank(): number {
    return this.id * 10;
  }
  both(): string {
    return this.who() + " " + this.rank;
  }
}

class Middle extends Base {
  extra = "m";
}

class Leaf extends Middle {
  more = "l";
}

function asBase(b: Base): string {
  return b.who() + " " + b.rank;
}

function asMiddle(m: Middle): string {
  return m.who() + " " + m.rank;
}

function asLeaf(l: Leaf): string {
  return l.who() + " " + l.rank;
}

const changed = new Leaf(1);
const honestLeaf = new Leaf(2);
const honestMiddle = new Middle(3);
const honestBase = new Base(4);

function round(label: string): void {
  console.log(label + ", the changed leaf: " + changed.who() + " | " + asLeaf(changed) + " | " + asMiddle(changed) + " | " + asBase(changed) + " | " + changed.both());
  console.log(label + ", the honest ones: " + asLeaf(honestLeaf) + " | " + asMiddle(honestLeaf) + " | " + asBase(honestLeaf) + " | " + asMiddle(honestMiddle) + " | " + asBase(honestMiddle) + " | " + asBase(honestBase) + " | " + honestLeaf.both());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += asLeaf(changed).length + asMiddle(changed).length + asBase(changed).length + asMiddle(honestMiddle).length + asBase(honestBase).length + changed.both().length;
console.log("2000 honest: " + warm);
round("before");

changed.who = () => "own";
round("an own method");

Object.defineProperty(changed, "rank", { value: -1, configurable: true });
round("an own value over the getter");

Reflect.deleteProperty(changed, "who");
Reflect.deleteProperty(changed, "rank");
round("uncovered");

const middle = new Middle(5);
middle.who = function () {
  return "own of the middle " + this.extra;
};
console.log("an instance of the middle class: " + asMiddle(middle) + " | " + asBase(middle) + " | " + middle.both());
round("the others after that");

const base = new Base(6);
base.who = () => "own of the base";
console.log("an instance of the base class: " + asBase(base) + " | " + base.both());
round("the others after that");

const list: Base[] = [changed, honestLeaf, middle, honestMiddle, base, honestBase];
console.log("elements: " + list.map(asBase).join(" | "));

export {};
