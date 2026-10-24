function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Counter {
  n = 0;
  step = 1;
  bump(): number {
    this.n += this.step;
    return this.n;
  }
  next(): number {
    return ++this.n;
  }
  scale(by: number): number {
    this.n *= by;
    return this.n;
  }
}

function increment(n: number): number {
  return n + 1;
}

function product(a: number, b: number): number {
  return a * b;
}

function remainder(a: number, b: number): number {
  return a % b;
}

function negate(n: number): number {
  return -n;
}

function halfDown(n: number): number {
  return Math.floor(n / 2);
}

function sumTo(limit: number, step: number): number {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += step;
  return sum;
}

function at(list: number[], index: number): number | undefined {
  return list[index];
}

attempt("small integers", () => [increment(1), product(3, 4), remainder(7, 3), negate(5), halfDown(7), sumTo(3, 2), at([1, 2], 1)]);
let warm = 0;
const busy = new Counter();
for (let i = 0; i < 2000; i++) warm += increment(i) + product(i, 2) + remainder(i, 7) + negate(i + 1) + halfDown(i) + busy.bump() + busy.next();
console.log("2000 rounds with small integers", warm, busy.n);

attempt("past the largest 32-bit integer", () => [increment(2147483647), increment(2147483646), product(65536, 32768), product(46341, 46341), sumTo(3, 1073741824), negate(-2147483648)]);
attempt("below the smallest", () => [increment(-2147483649), product(-65536, 32768), product(-65536, 32769), -2147483648 - 1]);
attempt("past 2 to the 53", () => [increment(9007199254740991), increment(9007199254740992), product(94906267, 94906267)]);
attempt("negative zero", () => [product(0, -1), product(-1, 0), remainder(-4, 2), remainder(-0, 5), negate(0), Math.round(-0.4), halfDown(-0), 0 / -5, Math.min(0, -0), Math.max(-0, 0), -0 + -0, -0 + 0, 0 - 0, -0 - 0]);
attempt("fractions", () => [increment(0.5), product(3, 0.5), remainder(5.5, 2), halfDown(5), 7 / 2, 6 / 2, 1 / 3]);
attempt("not a number and infinity", () => [remainder(1, 0), product(Infinity, 0), increment(Infinity), 0 / 0, 1 / 0, -1 / 0, remainder(Infinity, 2), halfDown(NaN)]);
attempt("a field that was always a small integer", () => {
  const c = new Counter();
  for (let i = 0; i < 2000; i++) c.bump();
  c.n = 2147483647;
  return [c.bump(), c.next(), c.n];
});
attempt("a field that turns fractional", () => {
  const c = new Counter();
  for (let i = 0; i < 2000; i++) c.next();
  c.step = 0.5;
  return [c.bump(), c.next(), c.scale(0.1)];
});
attempt("a field that turns into negative zero", () => {
  const c = new Counter();
  c.bump();
  c.scale(0);
  const zero = c.n;
  c.scale(-1);
  return [zero, c.n, 1 / c.n, c.next()];
});
attempt("a field that overflows by multiplication", () => {
  const c = new Counter();
  c.n = 3;
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) seen.push(c.scale(1000));
  return seen;
});
attempt("a loop counter past 32 bits", () => {
  let i = 2147483645;
  let rounds = 0;
  for (; i < 2147483650; i++) rounds++;
  return [i, rounds];
});
attempt("a loop counter that steps by a fraction", () => {
  let rounds = 0;
  for (let i = 0; i < 2; i += 0.5) rounds++;
  return rounds;
});
attempt("bit operations wrap", () => [2147483647 + 1 | 0, 4294967295 | 0, 4294967296 | 0, -1 >>> 0, 1 << 31, 1 << 32, 2147483648 >> 0, 2147483648 >>> 0, ~2147483647, 5e9 | 0, -5e9 | 0, 1.9 | 0, -1.9 | 0, NaN | 0, Infinity | 0]);
attempt("unsigned results in arithmetic", () => {
  const u = -1 >>> 0;
  return [u, u + 1, u * 2, u | 0, increment(u), at([1], u)];
});
attempt("odd indexes", () => [at([1, 2], -0), at([1, 2], 0.5), at([1, 2], -1), at([1, 2], 4294967295), at([1, 2], 4294967296), at([1, 2], NaN), at([1, 2], 1.0)]);
attempt("elements of a list of integers", () => {
  const list = [1, 2, 3];
  list[0] = 2147483648;
  list[1] = 0.5;
  list[2] = -0;
  return [list, list.map(increment), list.reduce(product, 1)];
});
attempt("Math functions", () => [Math.abs(-2147483648), Math.imul(65536, 65536), Math.imul(46341, 46341), Math.trunc(-0.5), Math.ceil(-0.5), Math.sign(-0), Math.floor(-0), Math.round(2.5), Math.round(-2.5), Math.round(0.49999999999999994), Math.pow(2, 31), 2 ** 53 + 1]);
attempt("small integers again", () => [increment(1), product(3, 4), remainder(7, 3), negate(5), halfDown(7), sumTo(3, 2)]);
