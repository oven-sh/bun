function listing(o: object): string {
  let walked = "";
  for (const key in o) walked += key + ",";
  return Object.keys(o).join() + " | " + walked + " | " + JSON.stringify(o) + " | " + Object.keys({ ...o }).join();
}

class FieldsAndParameters {
  first = 1;
  constructor(
    public given: number,
    readonly fixed: string,
  ) {}
  last = 2;
}

class Branching {
  declare a: number;
  declare b: number;
  declare c?: number;
  constructor(order: number) {
    if (order === 0) {
      this.a = 1;
      this.b = 2;
    } else if (order === 1) {
      this.b = 2;
      this.a = 1;
    } else {
      this.c = 3;
      this.b = 2;
      this.a = 1;
    }
  }
}

class Base {
  baseFirst = 1;
  constructor() {
    this.setup();
  }
  setup(): void {}
  baseLast = 2;
}

class Derived extends Base {
  declare early: number;
  derived = 3;
  setup(): void {
    this.early = 0;
  }
}

class StopsEarly {
  declare x: number;
  declare y: number;
  constructor(stop: boolean) {
    this.x = 1;
    if (stop) return;
    this.y = 2;
  }
}

class AddsOnTheWay {
  a = 1;
  b = (Object.assign(this, { slipped: true }), 2);
  c = 3;
}

class Looping {
  declare p: number;
  declare q: number;
  declare r: number;
  constructor(names: ("p" | "q" | "r")[]) {
    let n = 0;
    for (const name of names) this[name] = ++n;
  }
}

interface AB {
  a: number;
  b: number;
}

function sum(o: AB): number {
  return o.a * 10 + o.b;
}

console.log("fields and parameter properties: " + listing(new FieldsAndParameters(5, "f")));
for (let order = 0; order < 3; order++) console.log("a branch in the constructor, " + order + ": " + listing(new Branching(order)) + " " + sum(new Branching(order)));
console.log("a base constructor calls an override that stores: " + listing(new Derived()));
console.log("the base alone: " + listing(new Base()));
console.log("the constructor returns early: " + listing(new StopsEarly(true)) + " / " + listing(new StopsEarly(false)));
console.log("an initializer adds a member: " + listing(new AddsOnTheWay()));
console.log("stores in a loop: " + listing(new Looping(["r", "p", "q"])) + " / " + listing(new Looping(["q"])) + " / " + listing(new Looping([])));

function conditional(flag: boolean): { a?: number; b: number } {
  return { ...(flag ? { a: 1 } : {}), b: 2, ...(flag ? {} : { a: 1 }) };
}
console.log("a literal with conditional spreads: " + listing(conditional(true)) + " / " + listing(conditional(false)));

function twoBranches(flag: boolean): AB {
  if (flag) return { a: 1, b: 2 };
  return { b: 2, a: 1 };
}
console.log("a literal from two branches: " + listing(twoBranches(true)) + " / " + listing(twoBranches(false)));

let length = 0;
for (let i = 0; i < 2000; i++) length += listing(new Branching(0)).length + Object.keys(twoBranches(true))[0].length;
console.log("2000 of one order: " + length);
console.log("then the others: " + listing(new Branching(1)) + " / " + listing(new Branching(2)) + " / " + listing(twoBranches(false)));

const mixed: AB[] = [new Branching(0), new Branching(1), new Branching(2), twoBranches(true), twoBranches(false)];
console.log("in one array: " + JSON.stringify(mixed) + " " + mixed.map(sum).join());
console.log("first keys: " + mixed.map(o => Object.keys(o)[0]).join());

export {};
