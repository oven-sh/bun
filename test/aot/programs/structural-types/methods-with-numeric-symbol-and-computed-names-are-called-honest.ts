const mark: unique symbol = Symbol("mark");
const computed = "made" + "Up";
const literal = "spelled out";

class Odd {
  n = 1;
  0(): string {
    return "zero " + this.n;
  }
  1.5(): string {
    return "one and a half";
  }
  "quoted name"(): string {
    return "quoted";
  }
  [mark](): string {
    return "mark " + this.n;
  }
  [literal](): string {
    return "literal";
  }
  [Symbol.for("shared")](): string {
    return "never typed";
  }
  get 7(): number {
    return 70;
  }
  static 0(): string {
    return "static zero";
  }
  static [mark](): string {
    return "static mark";
  }
}

function facts(o: Odd): string {
  return [o[0](), o["0"](), o[1.5](), o["quoted name"](), o[mark](), o[literal](), o["spelled out"](), o[7], Odd[0](), Odd[mark]()].join(" | ");
}

function zeroOf(o: Odd): string {
  return o[0]();
}

function markOf(o: Odd): string {
  return o[mark]();
}

const o = new Odd();
const other = new Odd();

function round(label: string): void {
  console.log(label + ": " + facts(o) + " || " + zeroOf(o) + " " + markOf(o) + " || the other " + zeroOf(other) + " " + markOf(other));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts(o).length + zeroOf(other).length + markOf(other).length;
console.log("2000 honest: " + warm + " " + computed.length);
round("before");
console.log("names: " + Object.getOwnPropertyNames(Odd.prototype).join() + " symbols " + Object.getOwnPropertySymbols(Odd.prototype).length);

export {};
