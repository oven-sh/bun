class Numbers {
  round(x: number): number {
    return x < 0 ? -1 : 1;
  }
  parse(text: string): number {
    return text.length;
  }
  largest(a: number, b: number): number {
    return a > b ? a : b;
  }
  check(value: unknown): boolean {
    return value === this;
  }
  text(value: number): string {
    return "<" + value + ">";
  }
}

function show(value: unknown): string {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
}

function roundOf(n: Numbers, x: number): string {
  return show(n.round(x));
}

function all(n: Numbers): string {
  return [n.round(-0.4), n.round(2.5), n.parse("12px"), n.parse(""), n.largest(1, 2), n.largest(NaN, 2), n.check([]), n.check(n), n.text(255)].map(show).join(" ");
}

function round(label: string, n: Numbers): void {
  console.log(label + ": " + all(n) + " | " + roundOf(n, -0.4) + " " + roundOf(n, 2.5) + " | " + n.round.name + " " + n.parse.name + " " + n.largest.length);
}

const n = new Numbers();
const other = new Numbers();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += all(n).length + roundOf(other, i).length;
console.log("2000 honest: " + warm);
round("methods", n);

n.round = Math.round;
n.parse = parseFloat;
n.largest = Math.max;
n.check = Array.isArray;
n.text = String;
round("own built-ins", n);
round("the other", other);

n.round = Math.trunc;
n.parse = Number;
n.largest = Math.min;
n.check = Number.isInteger;
n.text = encodeURIComponent;
round("other built-ins", n);

n.round = Math.fround;
n.parse = parseInt;
n.largest = Math.atan2;
n.check = Boolean;
n.text = JSON.stringify;
round("a third set", n);

for (const name of Object.keys(n)) Reflect.deleteProperty(n, name);
round("uncovered", n);

const original = Numbers.prototype.round;
Numbers.prototype.round = Math.sign;
round("a built-in on the prototype", n);
round("the other", other);
Numbers.prototype.round = original;
round("put back", n);

export {};
