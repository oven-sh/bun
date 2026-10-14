// Strings: buffer byte length every length (the same program without type annotations).
const g = globalThis;
if (!g.Buffer) {
  g.Buffer = {
    byteLength(value) {
      let bytes = 0;
      for (let i = 0;i < value.length; i++)
        bytes += value.charCodeAt(i) < 128 ? 1 : 2;
      return bytes;
    }
  };
}
function ofText(s) {
  return Buffer.byteLength(s, "utf8");
}
g.kept = [ofText];
function make(length, high) {
  const units = [];
  for (let i = 0;i < length; i++)
    units.push(high(i) ? 128 + i * 7 % 128 : 32 + i * 5 % 95);
  return String.fromCharCode(...units);
}
let compared = 0;
let wrong = 0;
function check(s, expected) {
  compared++;
  const found = ofText(s);
  if (found === expected)
    return;
  if (++wrong < 6)
    console.log("wrong", s.length, expected, found);
}
for (let length = 0;length <= 72; length++) {
  check(make(length, () => false), length);
  check(make(length, () => true), 2 * length);
  for (let at = 0;at < length; at++) {
    check(make(length, (i) => i === at), length + 1);
    check(make(length, (i) => i !== at), 2 * length - 1);
  }
}
const long = make(200, (i) => i % 3 === 0);
for (let from = 0;from < 24; from++) {
  for (let to = from;to <= 200; to++) {
    let expected = 0;
    for (let i = from;i < to; i++)
      expected += i % 3 === 0 ? 2 : 1;
    check(long.slice(from, to), expected);
  }
}
console.log(compared, wrong);
