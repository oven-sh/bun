interface Unit {
  id: number;
  label(): string;
}

function define(tag: number) {
  return class Made {
    static made = 0;
    id = tag;
    constructor() {
      Made.made++;
    }
    label(): string {
      return "made by " + tag;
    }
    sameClass(other: object): boolean {
      return other instanceof Made;
    }
  };
}

const First = define(1);
const Second = define(2);

const a = new First();
const b = new Second();
const alias: InstanceType<typeof First> = b;

console.log("two evaluations are two classes: " + (First === Second) + " " + (First.prototype === Second.prototype));
console.log("labels: " + a.label() + ", " + b.label() + ", " + alias.label());
console.log("instanceof: " + (a instanceof First) + " " + (a instanceof Second) + " " + (alias instanceof First) + " " + (alias instanceof Second));
console.log("asked from inside: " + a.sameClass(a) + " " + a.sameClass(b) + " " + b.sameClass(a) + " " + b.sameClass(b));
console.log("statics are apart: " + First.made + " " + Second.made);
new First();
new First();
console.log("after two more of the first: " + First.made + " " + Second.made);
console.log("names: " + First.name + " " + Second.name + " " + a.constructor.name + " " + (a.constructor === b.constructor));

function label(u: Unit): string {
  return u.label();
}

function isFirst(u: InstanceType<typeof First>): boolean {
  return u instanceof First;
}

let length = 0;
let yes = 0;
for (let i = 0; i < 2000; i++) {
  length += label(a).length;
  if (isFirst(a)) yes++;
}
console.log("2000 of the first: " + length + " " + yes);
console.log("then the second: " + label(b) + " " + isFirst(b));

const classes: (typeof First)[] = [];
for (let i = 0; i < 100; i++) classes.push(define(i));
const instances = classes.map(C => new C());
console.log("a hundred classes: " + instances.map(u => u.id).reduce((x, y) => x + y, 0) + " " + label(instances[99]) + " " + label(instances[0]));
console.log("each is an instance of its own only: " + instances.filter((u, i) => u instanceof classes[i]).length + " " + instances.filter((u, i) => u instanceof classes[(i + 1) % 100]).length);
console.log("statics: " + classes.map(C => C.made).reduce((x, y) => x + y, 0));

First.prototype.label = () => "patched first";
console.log("one prototype patched: " + label(a) + ", " + label(b) + ", " + label(instances[1]));

function counter() {
  let count = 0;
  return {
    next(): number {
      return ++count;
    },
    get current(): number {
      return count;
    },
  };
}

const one = counter();
const two = counter();
one.next();
one.next();
two.next();
console.log("literals from one function keep their own closures: " + one.current + " " + two.current + " " + (one.next === two.next));

function subclass(Base: typeof First, extra: number) {
  return class extends Base {
    label(): string {
      return super.label() + " plus " + extra;
    }
  };
}

const OverFirst = subclass(First, 10);
const OverSecond = subclass(Second, 20);
console.log("one subclass expression over two bases: " + new OverFirst().label() + ", " + new OverSecond().label());
console.log("chains: " + (new OverSecond() instanceof First) + " " + (new OverSecond() instanceof Second) + " " + (new OverFirst() instanceof First));

export {};
