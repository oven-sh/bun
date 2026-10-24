enum Bit {
  None = 0,
  Low = 1,
  Top = 1 << 31,
  All = ~0,
}

function has(bits: Bit, bit: Bit): boolean {
  return (bits & bit) === bit;
}
function hasAny(bits: Bit, bit: Bit): boolean {
  return (bits & bit) !== 0;
}
function unsigned(bits: Bit): number {
  return bits >>> 0;
}
function without(bits: Bit, bit: Bit): Bit {
  return bits & ~bit;
}

console.log(Bit.Top, Bit.All, Bit[Bit.Top], Bit[Bit.All], Bit[-1], Bit[2147483648]);
console.log(has(Bit.All, Bit.Top), has(Bit.Top, Bit.Low), hasAny(Bit.Top, Bit.All), unsigned(Bit.Top), unsigned(Bit.All));
console.log(without(Bit.All, Bit.Top), without(Bit.Top, Bit.Top), without(Bit.None, Bit.All));
const wideTop: number = 2 ** 31;
const topBit: Bit = wideTop;
console.log(topBit === Bit.Top, has(topBit, Bit.Top), hasAny(topBit, Bit.Top), unsigned(topBit), topBit | 0, Bit[topBit]);
const doubled: Bit = Bit.Top * 2;
console.log(doubled, doubled | 0, has(doubled, Bit.Top), unsigned(doubled));
const summed: Bit = Bit.Top + Bit.Top + Bit.Low;
console.log(summed, summed | 0, has(summed, Bit.Low), unsigned(summed));
let walking: Bit = Bit.Low;
let steps = 0;
while (walking !== Bit.None && steps < 40) {
  walking <<= 1;
  steps++;
}
console.log(steps, walking);
