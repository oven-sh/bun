class Meter {
  reading = 1;
  read(): number {
    return this.reading;
  }
  each(count: number, visit: (i: number) => void): number[] {
    const seen: number[] = [];
    for (let i = 0; i < count; i++) {
      seen.push(this.read());
      visit(i);
      seen.push(this.read());
    }
    return seen;
  }
}

function loop(m: Meter, count: number, visit: (i: number) => void): number[] {
  const seen: number[] = [];
  for (let i = 0; i < count; i++) {
    seen.push(m.read());
    visit(i);
    seen.push(m.read());
  }
  return seen;
}

const original = Meter.prototype.read;
const view = (m: Meter): { read?: () => number } => m;

const own = new Meter();
console.log(
  "an own member, from outside: " +
    loop(own, 5, i => {
      if (i === 1) own.read = () => 20;
      if (i === 3) delete view(own).read;
    }).join(" "),
);

const inside = new Meter();
console.log(
  "an own member, from a method: " +
    inside
      .each(5, i => {
        if (i === 1) inside.read = () => 30;
        if (i === 3) delete view(inside).read;
      })
      .join(" "),
);

const shared = new Meter();
console.log(
  "the prototype, from outside: " +
    loop(shared, 5, i => {
      if (i === 1) Meter.prototype.read = () => 40;
      if (i === 3) Meter.prototype.read = original;
    }).join(" "),
);

console.log(
  "the prototype, from a method: " +
    shared
      .each(5, i => {
        if (i === 1)
          Meter.prototype.read = function () {
            return this.reading + 50;
          };
        if (i === 3) Meter.prototype.read = original;
      })
      .join(" "),
);

const late = new Meter();
const long = loop(late, 2004, i => {
  if (i === 2000) late.read = () => 60;
  if (i === 2002) delete view(late).read;
});
console.log("after 2000 rounds of the loop: " + long.slice(-10).join(" ") + ", sum " + long.reduce((a, b) => a + b, 0));

const sorted = new Meter();
const order: number[] = [];
[3, 1, 2].forEach(n => {
  order.push(sorted.read());
  sorted.read = () => n;
});
order.push(sorted.read());
console.log("by a callback of a built-in: " + order.join(" "));

export {};
