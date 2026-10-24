// The same kinds of matches against RegExp literals that nothing else touches, in a program that does read what the last match left in `RegExp`: every hit is recorded, a miss leaves the record alone.
const digits = /(\d)(\d)?/;
const codePoints = /(.)\d/u;
const everyDigit = /\d/g;
const plainText = /12/;

function left(): string {
  return [RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.$1, RegExp.$2, RegExp.lastParen, (RegExp as any).input].map(part => JSON.stringify(part)).join();
}
function join(first: string, second: string): string {
  return first + second;
}

const narrow = "ab-12 BBc 345 e6";
const wide = "中文 ab-12 \u{1f600}3 bbC 45";
for (const subject of [() => narrow, () => join(narrow.slice(0, 4), narrow.slice(4)), () => wide, () => join(wide.slice(0, 9), wide.slice(9)), () => join("no ", "match"), () => ""]) {
  console.log(digits.test(subject()), left());
  console.log(digits.exec(subject())?.index, left());
  console.log(subject().search(digits), left());
  console.log(subject().match(digits)?.index, left());
  console.log(codePoints.test(subject()), left());
  console.log(codePoints.exec(subject())?.index, left());
  console.log(everyDigit.test(subject()), everyDigit.lastIndex, left());
  console.log(subject().match(everyDigit)?.length, everyDigit.lastIndex, left());
  console.log(plainText.test(subject()), left());
  console.log(subject().search(plainText), left());
}
