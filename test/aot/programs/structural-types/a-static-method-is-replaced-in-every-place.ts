class Ids {
  static last = 0;
  static next(): number {
    return ++Ids.last;
  }
  static pair(): string {
    return Ids.next() + "," + this.next();
  }
  fresh(): number {
    return Ids.next();
  }
}

class Holder {
  source: typeof Ids = Ids;
  ask(): number {
    return this.source.next();
  }
}

function direct(): number {
  return Ids.next();
}

function byParameter(c: typeof Ids): number {
  return c.next();
}

function byShape(c: { next(): number }): number {
  return c.next();
}

function byElement(list: (typeof Ids)[]): number {
  return list[0].next();
}

const holder = new Holder();
const list = [Ids];
const instance = new Ids();
const captured = (): number => Ids.next();

function everywhere(label: string): void {
  const local = Ids;
  Ids.last = 0;
  console.log(label + ": " + [Ids.next(), direct(), local.next(), byParameter(Ids), byShape(Ids), holder.ask(), byElement(list), captured(), instance.fresh()].join(" ") + " | " + Ids.pair() + " | last " + Ids.last);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += direct() + byParameter(Ids) + byShape(Ids) + holder.ask() + byElement(list) + captured() + instance.fresh();
console.log("2000 honest: " + warm);
everywhere("before");

const original = Ids.next;
Ids.next = () => -1;
everywhere("an arrow");

Ids.next = function () {
  return (this.last += 10);
};
everywhere("a function that reads this");

Ids.next = original.bind({ last: 0 });
everywhere("the original, bound to something else");

Ids.next = original;
everywhere("put back");

const taken = Ids.next;
console.log("taken off the class: " + taken() + " " + taken());
const pair = Ids.pair;
try {
  console.log("a static method that uses this, taken off: " + pair());
} catch (error) {
  console.log("a static method that uses this, taken off: threw " + (error instanceof Error ? error.constructor.name : typeof error));
}

export {};
