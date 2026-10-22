function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

class Totals {
  whole: number = 0;
  real: number = 0;
  last: number = 0;
  seen: number[] = [];
}

function* counter(totals: Totals): Generator<number, never, number> {
  let whole = 0;
  let real = 0.5;
  for (;;) {
    const sent: number = yield whole;
    whole += sent;
    real += sent / 2;
    totals.whole = whole;
    totals.real = real;
    totals.last = sent;
    if (totals.seen.length < 4 || sent !== 1) totals.seen.push(sent);
  }
}

function show(label: string, totals: Totals): void {
  console.log(label + ": whole " + text(totals.whole) + ", real " + text(totals.real) + ", last " + text(totals.last));
  console.log(label + ": seen " + totals.seen.map(text).join(", ") + " " + JSON.stringify(totals.seen));
}

function push(generator: Generator<number, never, number>, n: number): number {
  return generator.next(n).value;
}

const totals = new Totals();
const counting = counter(totals);
counting.next();
let lastYield = 0;
for (let i = 0; i < 2000; i++) lastYield = push(counting, 1);
console.log("after 2000: " + text(lastYield));
show("after 2000", totals);

console.log("nothing sent: " + text(counting.next().value));
show("nothing sent", totals);
console.log("then 1: " + text(push(counting, 1)));
show("then 1", totals);

const fresh = new Totals();
const second = counter(fresh);
second.next();
for (let i = 0; i < 2000; i++) push(second, 1);
console.log("a fraction: " + text(push(second, 0.25)));
console.log("past 2 ** 31: " + text(push(second, 2147483647)));
console.log("minus zero: " + text(push(second, -0)));
console.log("not a number: " + text(push(second, NaN)));
show("second", fresh);

const third = counter(new Totals());
const loose: Iterator<number> = third;
console.log("loose start: " + text(loose.next()));
console.log("loose 5: " + text(loose.next(5)));
console.log("loose text: " + text(loose.next("6")));
console.log("loose 7: " + text(loose.next(7)));
console.log("loose null: " + text(loose.next(null)));
console.log("loose object: " + text(loose.next({ valueOf: () => 3 })));
