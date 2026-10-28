// A function cuts a part out of a string, hands numbers to a second function in a loop, and returns the part. The second function then gets the first character of the part.
function pass(value) {
  return value;
}
function cut() {
  const part = "ab".slice(1);
  for (const number of [1]) pass(number);
  return part;
}
const part = cut();
cut();
console.log(pass(part[0]));
