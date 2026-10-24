const log: string[] = [];

class Money {
  amount: number;
  constructor(amount: number) {
    this.amount = amount;
  }
  [Symbol.toPrimitive](hint: string): string | number {
    log.push("class:" + hint);
    return hint === "string" ? "$" + this.amount : this.amount;
  }
  valueOf(): number {
    log.push("valueOf");
    return -this.amount;
  }
  toString(): string {
    log.push("toString");
    return "money " + this.amount;
  }
}

function template(m: Money): string {
  return `${m}`;
}

function concat(m: Money): string {
  return "" + m;
}

function concatAfter(m: Money): string {
  return m + "!";
}

function plus(m: Money): number {
  return +m;
}

function less(a: Money, b: Money): boolean {
  return a < b;
}

function all(m: Money): string {
  return [template(m), concat(m), concatAfter(m), plus(m), Number(m), String(m), less(m, m), [m].join(), isNaN(+m), Math.max(+m, 0), "x".repeat(Number(m) > 0 ? 1 : 0), new Date(+m).getTime()].join(" | ");
}

function round(label: string, m: Money): void {
  log.length = 0;
  try {
    const text = all(m);
    console.log(label + ": " + text);
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
  console.log(label + ", ran: " + log.join(" "));
}

const m = new Money(5);
const other = new Money(7);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += template(m).length + concat(m).length + plus(m) + (less(m, other) ? 1 : 0);
console.log("2000 honest: " + warm);
round("the class's method", m);

export {};
