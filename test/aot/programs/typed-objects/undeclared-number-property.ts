// A number that is not an integer, stored under a name the class does not declare, reads back unchanged however often one typed site reads it.
class Sample {
  id = 1;
}
type Weighted = Sample & { ratio: number };

function ratioOf(sample: Weighted): number {
  return sample.ratio;
}
const show = (value: number) => (Object.is(value, -0) ? "-0" : String(value));

const lines: string[] = [];
for (const ratio of [1.5, -0.25, 0.1, 1e300, 5e-324, -0, 3, NaN, -Infinity]) {
  const sample: Weighted = Object.assign(new Sample(), { ratio });
  lines.push([ratioOf(sample), ratioOf(sample), ratioOf(sample)].map(show).join(" "));
}

const shared: Weighted = Object.assign(new Sample(), { ratio: 1.5 });
let sum = 0;
for (let i = 0; i < 1000; i++) sum += ratioOf(shared) * 2;
lines.push(show(sum));

(shared as any).ratio = 2.25;
lines.push(show(ratioOf(shared) + ratioOf(shared)));
console.log(lines.join("\n"));
