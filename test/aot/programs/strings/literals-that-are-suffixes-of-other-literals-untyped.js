// String literals that are suffixes of other string literals, which may share storage in the executable (the same program without type annotations).
const kept = [];
function texts() {
  return ["a whole text with a tail", "text with a tail", "with a tail", "a tail", "tail", "il", "l", ""];
}
function others() {
  return ["a whole text with a tai", "whole text", "a whole", "ext with a tail", "A tail", "a tail ", "tail\xE9", "\xE9tail"];
}
function asKeys() {
  return { "a whole text with a tail": 1, "with a tail": 2, tail: 3, il: 4 };
}
const a = texts();
const b = others();
const k = asKeys();
kept.push(a, b, k);
for (const s of a)
  console.log(JSON.stringify(s), s.length, a[0].endsWith(s), a[0].slice(a[0].length - s.length) === s, s in k, k[s]);
for (const s of b)
  console.log(JSON.stringify(s), s.length, a[0].endsWith(s), a.includes(s), s in k);
console.log(a.join("|"), b.join("|"), a[4] + a[5], a[3] === "a " + a[4], Object.keys(k).join());
switch (a[4]) {
  case "a tail":
    console.log("wrong");
    break;
  case "tail":
    console.log("right");
    break;
  default:
    console.log("none");
}
