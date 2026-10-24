// The length of an array is up to 2^32 - 1. Read in a loop from a value nothing is known about, it comes boxed.
function lengths(holder) {
  const list = holder.list;
  let sum = 0;
  for (let i = 0; i < 2; i++) sum += list.length + (list[i] === undefined ? 0 : 1);
  return sum;
}
function isBelow(holder, bound) {
  const list = holder.list;
  let answers = "";
  for (let i = 0; i < 2; i++) answers += (bound < list.length) + " " + (list.length <= bound) + " " + String(list[i]) + " ";
  return answers;
}
for (const length of [0, 1, 2147483646, 2147483647, 2147483648, 2147483649, 4294967294, 4294967295]) {
  const list = [];
  list.length = length;
  console.log(length, lengths({ list }), isBelow({ list }, 2147483647), isBelow({ list }, 2147483648.5), isBelow({ list }, -1));
  if (length) list[0] = "first";
  console.log(length, lengths({ list }), list.length === length);
}
