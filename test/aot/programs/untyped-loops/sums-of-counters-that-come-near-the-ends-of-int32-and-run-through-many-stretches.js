function up(from, to, by) {
  let sum = 0;
  for (let i = from; i < to; i += by) sum += i;
  return sum;
}
function down(from, to, by) {
  let sum = 0;
  for (let i = from; i > to; i -= by) sum += i;
  return sum;
}
function less(from, to, start) {
  let sum = start;
  for (let i = from; i < to; i++) sum -= i;
  return sum;
}
function two(to) {
  let odd = 0.5, even = 0;
  for (let i = 0; i < to; i++) {
    odd += i;
    even += i & 1;
  }
  return odd + "," + even;
}
const show = value => (Object.is(value, -0) ? "-0" : String(value));
for (let round = 0; round < 3; round++) {
  console.log(show(up(0, 0, 1)), show(up(0, 1, 1)), show(up(0, 7, 1)), show(up(0, 8, 1)), show(up(0, 9, 1)), show(up(0, 1000, 1)));
  console.log(show(up(2147483000, 2147483647, 1)), show(up(2147483640, 2147483647, 1)), show(up(2147483639, 2147483647, 3)), show(up(-2147483648, -2147483000, 1)));
  console.log(show(down(2147483647, 2147483000, 1)), show(down(-2147483000, -2147483648, 1)), show(down(-2147483640, -2147483648, 7)), show(down(10, -10, 1)));
  console.log(show(up(0, 1048575, 1)), show(up(0, 1048576, 1)), show(up(0, 1048577, 1)), show(up(0, 1048584, 1)), show(up(5, 3145733, 1)), show(up(0, 5000000, 3)));
  console.log(show(up(2000000000, 2010000000, 1)), show(up(0, 200000000, 1)), show(down(2147483647, 1947483647, 1)));
  console.log(show(less(0, 0, -0)), show(less(0, 1, -0)), show(less(0, 20, -0)), show(less(0, 20, 0.5)), show(less(0, 20, 4503599627370496)), show(less(0, 3000000, 2251799813685247)), show(less(1, 20, NaN)), show(less(1, 20, Infinity)));
  console.log(two(0), two(9), two(2097169));
  console.log(show(up(0, 2.5, 1)), show(up(0.5, 20, 1)), show(up(0, 4294967296 / 400, 1)), show(up(0, NaN, 1)), show(up(-0, 12, 1)));
}
