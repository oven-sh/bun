// A field that starts at zero is only ever added to and subtracted from: by constants, by itself, by integers that are never negative, by integers of either sign. Every number it holds is reached by such sums alone. It is brought to both sides of each multiple of 2^32 that matters, of 2^52 and of 2^53, and each sum from there on is printed.
class Sum {
  constructor() {
    this.n = 0;
  }
  up() {
    this.n++;
  }
  down() {
    this.n--;
  }
  double() {
    this.n += this.n;
  }
  addThree() {
    this.n += 3;
  }
  takeThree() {
    this.n -= 3;
  }
  addMost() {
    this.n += 2147483647;
  }
  takeMost() {
    this.n -= 2147483647;
  }
  addPositive(x) {
    this.n += x & 0x7fffffff;
  }
  takePositive(x) {
    this.n -= x & 0x7fffffff;
  }
  addInteger(x) {
    this.n += x | 0;
  }
  addThreeAndRead() {
    this.n += 3;
    return this.n;
  }
  readAndCount() {
    return this.n++;
  }
}
function at(start) {
  const sum = new Sum();
  for (const bit of Math.abs(start).toString(2)) {
    sum.double();
    if (bit === "1") {
      if (start < 0) sum.down();
      else sum.up();
    }
  }
  return sum;
}
const out = [];
const starts = [
  0, 1, 2, 3, 2147483645, 2147483647, 2147483648, 4294967293, 4294967295, 4294967296, 4294967298, 8589934591,
  4503595332403200, 4503599627370492, 4503599627370495, 4503599627370496, 9007199254740988, 9007199254740991,
];
for (const size of starts) {
  for (const start of [size, -size, -size - 1]) {
    for (const step of [
      "up",
      "down",
      "addThree",
      "takeThree",
      "addMost",
      "takeMost",
      "double",
      "addThreeAndRead",
      "readAndCount",
    ]) {
      const sum = at(start);
      const seen = [];
      for (let i = 0; i < 5; i++) seen.push(sum[step](), sum.n);
      out.push(start + " " + step + " " + seen.join() + " " + JSON.stringify(sum) + " " + Object.keys(sum));
    }
    for (const x of [0, 1, 3, 8000, 2147483647]) {
      const sum = at(start);
      const seen = [];
      for (let i = 0; i < 3; i++) {
        sum.addPositive(x);
        seen.push(sum.n);
      }
      for (let i = 0; i < 6; i++) {
        sum.takePositive(x);
        seen.push(sum.n);
      }
      out.push(start + " positive " + x + " " + seen.join());
    }
    for (const x of [0, 5, -5, 2147483647, -2147483648]) {
      const sum = at(start);
      sum.addInteger(x);
      sum.addInteger(x);
      out.push(start + " integer " + x + " " + sum.n);
    }
  }
}
console.log(out.join("\n"));
