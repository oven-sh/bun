// A loop whose test of an element fails now and then, so that its slow copy runs a turn and comes back, and whose counter passes 2 ** 31 on the way.
function count(from, to, list) {
  let sum = 0;
  let last = 0;
  for (let i = from; i < to; i++) {
    const value = list[i & 7];
    sum = (sum + (typeof value === "number" ? value : value.length) + (i & 3)) | 0;
    last = i;
  }
  return sum + ":" + last;
}
const list = [1, 2, "three", 4, 5.5, 6, [7], 8];
console.log(count(0, 1000, list));
console.log(count(2147483000, 2147484500, list));
console.log(count(-2147483700, -2147483000, list));
console.log(count(0, 10.5, list), count(0, NaN, list), count(3, -Infinity, list), count(4294967290, 4294967300, list));
function down(from, to, list) {
  let sum = 0;
  for (let i = from; i > to; i--) sum = (sum + (typeof list[i & 7] === "number" ? 1 : 2) + (i & 1)) | 0;
  return sum;
}
console.log(down(1000, 0, list), down(-2147483000, -2147484500, list), down(2147484500, 2147483000, list), down(5, 0.5, list));
