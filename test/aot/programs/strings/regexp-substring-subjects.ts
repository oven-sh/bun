const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const names = ["operationAOTRegExpTest", "operationAOTRegExpTestBoxed", "operationAOTRegExpExec", "operationAOTStringMatchRegExp", "operationAOTStringReplaceRegExpString"];
const entries = () => names.reduce((sum, name) => sum + count(name), 0);

const narrow = "let total = 12 + -345 * x9 - 0x1f; // 678 done, 90";
const wide = "\u4e2d\u6587 " + narrow + " \u7d42 12\u5186 \u03c0";
const number = /^-?\d+$/;
const word = /^([a-z]+)(\d*)$/;
const digits = /\d+/g;
function legacy() {
  return [RegExp.lastMatch, RegExp.$1, RegExp.leftContext, RegExp.rightContext, RegExp.input].join("|");
}
function tokens(source: string) {
  const lines: string[] = [];
  let from = 0;
  for (let to = 0; to <= source.length; to++) {
    if (to < source.length && source[to] !== " ") continue;
    if (to - from > 1) {
      const token = source.slice(from, to);
      const isNumber = number.test(token);
      const seen = legacy();
      const again = source.substring(from, to);
      const found = word.exec(again);
      const third = source.slice(from, to);
      const matched = third.match(word);
      const fourth = source.slice(from, to);
      const replaced = fourth.replace(digits, "#");
      lines.push(`${token} ${isNumber} [${seen}] ${JSON.stringify(found)} ${found?.index} ${found?.input === token} ${JSON.stringify(matched)} ${replaced} ${replaced === fourth} [${legacy()}]`);
    }
    from = to + 1;
  }
  return lines;
}
console.log(tokens(narrow).join("\n"));
console.log(tokens(wide).join("\n"));

const nested = narrow.slice(4, 40).slice(8, 20).slice(1);
console.log(JSON.stringify(nested), /^\d/.test(nested), /x9$/.test(nested.slice(0, 10)), /(\d+)\D+(\d+)/.exec(nested.slice(1))?.join());
const group = /= (.+);/.exec(narrow)![1];
console.log(JSON.stringify(group), /^\d+ \+/.test(group), group.replace(/[a-z]\d/, "?"), group.match(/0x[0-9a-f]+$/)?.index);
const joined = narrow.slice(0, 9) + narrow.slice(9, 14);
console.log(number.test(joined), /total = 1$/.test(joined), /^let/.test(joined + "!"));

const before = entries();
let hits = 0;
for (let i = 0; i < 4000; i++) {
  const from = i % 20;
  if (number.test(narrow.slice(from, from + 6))) hits++;
  if (number.test(wide.slice(from, from + 7))) hits++;
  if (word.exec(narrow.slice(from + 12, from + 15))) hits++;
  if (narrow.slice(from, from + 3).match(/^\d\d\d$/)) hits++;
  if (narrow.slice(0, from + 2).replace(/[A-Z]+/g, "") !== "") hits++;
}
console.log(hits, entries() - before < 1200 ? "few entries" : "MANY ENTRIES");
