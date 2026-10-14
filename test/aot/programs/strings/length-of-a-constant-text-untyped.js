// Strings: length of a constant string (the same program without type annotations).
const g = globalThis;
function text() {
  return "returned-1";
}
function ofConstant() {
  return "twelve chars".length;
}
function ofInlined() {
  return text().length;
}
function ofCast() {
  return "a text that is cast".length;
}
function ofEmpty() {
  return "".length;
}
function ofWide() {
  return "na\xEFve \u2603 \uD83D\uDE00".length;
}
function returned() {
  return "a text that gets out";
}
function ofGiven(s) {
  return s.length;
}
function inBranch(n) {
  return "abc".length > n ? "longer" : "not longer";
}
g.kept = [ofConstant, ofInlined, ofCast, ofEmpty, ofWide, returned, ofGiven, inBranch];
const kept = g.kept;
console.log(kept[0](), kept[1](), kept[2](), kept[3](), kept[4](), kept[5](), kept[6]("four"), kept[6](""), kept[7](2), kept[7](3));
let sum = 0;
for (let i = 0;i < 100; i++)
  sum += kept[0]() + kept[1]() + kept[4]();
console.log(sum);
