const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const entries = () => count("operationAOTStringReplaceRegExpString");

const separators = /\u2028|\u2029/g;
const first = /(\d+)\u5186/;
function clean(text: string) {
  return text.replace(separators, " ");
}
function price(text: string) {
  return text.replace(first, "<$1>");
}
const subjects = ["", "plain", "caf\xe9", "\u4e2d\u6587", "a\u2028b", "\u2029", "\u4e2d\u2028\u6587\u2029", "100\u5186", "\u7d04 250\u5186 \u3068 30\u5186", "x".repeat(40) + "\u4e2d", "\ud83d\ude00 5\u5186"];
for (const subject of subjects) {
  separators.lastIndex = 3;
  const cleaned = clean(subject);
  console.log(JSON.stringify(cleaned), cleaned === subject, separators.lastIndex, JSON.stringify(price(subject)), JSON.stringify(RegExp.lastMatch), JSON.stringify(RegExp.$1));
}
const rope = "\u4e2d" + subjects[1] + String(subjects.length);
console.log(JSON.stringify(clean(rope)), JSON.stringify(clean(rope.slice(1))), JSON.stringify(price(rope + "\u5186")));

const wide = "\u250c" + "\u2500".repeat(30) + "\u2510 text";
const before = entries();
let kept = 0;
for (let i = 0; i < 4000; i++) {
  if (clean(wide) === wide) kept++;
  if (price(wide) === wide) kept++;
}
console.log(kept, entries() - before < 400 ? "few entries" : "MANY ENTRIES");
