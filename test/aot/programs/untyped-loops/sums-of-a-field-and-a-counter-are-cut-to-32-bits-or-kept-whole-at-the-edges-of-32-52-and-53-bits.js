// Sums and differences of a field of an instance of a function and a counter, cut to 32 bits or kept whole, for small integers, integers at the edges of 32, 52 and 53 bits, fractions and what is no number.
function Holder(x) {
  if (x !== "left out") this.x = x;
}
Holder.prototype.get = function () {
  return this.x;
};
const values = [
  0,
  -0,
  1,
  -1,
  7,
  2147483647,
  -2147483643,
  -2147483648,
  2147483648,
  4294967295,
  2 ** 40,
  -(2 ** 40),
  2 ** 51,
  2 ** 52,
  2 ** 52 + 1,
  -(2 ** 52) - 1,
  2 ** 53 - 1,
  2 ** 53,
  2 ** 53 + 2,
  -(2 ** 53) - 2,
  2 ** 62,
  2 ** 63,
  1e300,
  1.5,
  -0.5,
  NaN,
  Infinity,
  undefined,
  null,
  true,
  "3",
  "left out",
];
function cutSum(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + holder.get() + i) | 0;
  return sum;
}
function cutDifference(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum - holder.get() - i) | 0;
  return sum;
}
function cutUnsigned(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (holder.get() + sum + i) >>> 0;
  return sum;
}
function wholeSum(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = sum + holder.get() + i;
  return sum;
}
function signOfZero(holder, turns) {
  let last = 1;
  for (let i = 0; i < turns; i++) last = 1 / (holder.get() - holder.get() + (i - i));
  return last;
}
for (const value of values) {
  const holder = new Holder(value);
  console.log(
    String(value),
    cutSum(holder, 1000),
    cutDifference(holder, 1000),
    cutUnsigned(holder, 1000),
    String(wholeSum(holder, 1000)),
    signOfZero(holder, 10),
  );
}
