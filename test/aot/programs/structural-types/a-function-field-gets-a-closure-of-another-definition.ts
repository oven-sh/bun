class Filter {
  limit = 10;
  accept: (n: number) => boolean = n => n < this.limit;
  count(values: number[]): number {
    let hits = 0;
    for (const v of values) if (this.accept(v)) hits++;
    return hits;
  }
}

class Holder {
  filter: Filter;
  constructor(filter: Filter) {
    this.filter = filter;
  }
  ask(n: number): boolean {
    return this.filter.accept(n);
  }
}

function byParameter(f: Filter, n: number): boolean {
  return f.accept(n);
}

function byElement(list: Filter[], n: number): boolean {
  return list[0].accept(n);
}

function isEven(n: number): boolean {
  return n % 2 === 0;
}

class Other {
  limit = 3;
  accept(n: number): boolean {
    return n > this.limit;
  }
}

const changed = new Filter();
const honest = new Filter();
const holder = new Holder(changed);
const list = [changed];
const captured = (n: number): boolean => changed.accept(n);
const values = [1, 2, 5, 8, 11, 14];

function everywhere(label: string): void {
  const local = changed;
  console.log(label + ": " + [changed.accept(5), local.accept(5), byParameter(changed, 5), holder.ask(5), byElement(list, 5), captured(5)].join(" ") + " count " + changed.count(values) + " | honest " + byParameter(honest, 5) + " count " + honest.count(values) + " | name " + JSON.stringify(changed.accept.name));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += changed.count(values) + honest.count(values) + (byParameter(changed, i) ? 1 : 0) + (holder.ask(i) ? 1 : 0);
console.log("2000 honest: " + warm);
everywhere("the initializer's arrow");

const first = changed.accept;
changed.accept = isEven;
everywhere("a declared function");
changed.accept = n => n > 100;
everywhere("another arrow");
changed.accept = function (n) {
  return n === this.limit;
};
everywhere("a function expression that reads this");
changed.limit = 5;
everywhere("after a store to the limit");
changed.accept = new Other().accept;
everywhere("a method of another class");
changed.accept = Number.isInteger;
everywhere("a built-in");
changed.accept = isEven.bind(null);
everywhere("a bound function");
changed.accept = new Proxy(isEven, {});
everywhere("a proxy");
changed.accept = honest.accept;
everywhere("the arrow of the other filter");
honest.limit = 2;
everywhere("after a store to the other filter's limit");
changed.accept = first;
everywhere("the first one again");

export {};
