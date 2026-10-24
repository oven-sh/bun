// A subject that has just been put together from parts (a rope) is matched like any other: test, exec, match and replace give what plain Bun gives, and the parts are joined once.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const names = ["operationAOTRegExpTest", "operationAOTRegExpTestBoxed", "operationAOTRegExpExec", "operationAOTStringMatchRegExp", "operationAOTStringReplaceRegExpString"];
const entries = () => names.reduce((sum, name) => sum + count(name), 0);
function show(match: RegExpMatchArray | RegExpExecArray | null) {
  return match ? `${JSON.stringify(match)}@${match.index} of ${JSON.stringify(match.input)} ${match.length}` : "null";
}
function legacy() {
  return [RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.$1].map(part => JSON.stringify(part)).join();
}
const heads = ["text/html; ", "W/\"", "", "a", "caf\xe9 ", "\u4e2d\u6587 ", "key-" + "x".repeat(40) + " "];
const tails = ["charset=utf-8", "c-abc\"", "", "b", "\xe9t\xe9 12", "\u6587 7", "bad\x01value", "y".repeat(50) + " = 345"];
const patterns = [/[^\t\x20-\x7e\x80-\xff]/, /(\w+)=(\S+)/, /\d+/, /["<>&]/, /\s(\S)/, /^\S+$/, /\xe9+/, /[\u4e00-\u4eff]\s/, /(?<key>[a-z]+)-/, /z{3}/];
for (const pattern of patterns) {
  for (const head of heads) {
    for (const tail of tails) {
      console.log(String(pattern), JSON.stringify((head + tail).slice(0, 30)), pattern.test(head + tail), legacy(), show(pattern.exec(head + tail)), show((head + tail).match(pattern)), JSON.stringify((head + tail).replace(pattern, "<$&>").slice(0, 40)));
    }
  }
}
for (const pattern of [/\d+/g, /[a-z]+/y, /\s+/g, /\xe9/g]) {
  for (const head of heads) {
    const subject = head + "12 ab " + head + " 3";
    const found: string[] = [];
    pattern.lastIndex = 0;
    for (let match = pattern.exec(subject); match && found.length < 9; match = pattern.exec(subject)) found.push(`${match[0]}@${match.index}:${pattern.lastIndex}`);
    pattern.lastIndex = 2;
    console.log(String(pattern), JSON.stringify(head.slice(0, 12)), found.join(), pattern.test(head + "12 ab " + tails[0]), pattern.lastIndex, JSON.stringify((head + "1 \xe9 2" + head).replace(pattern, "_").slice(0, 40)));
  }
}
function nested(depth: number, part: string): string {
  return depth ? nested(depth - 1, part) + part + depth : part;
}
console.log(/9x8/.test(nested(12, "x")), show(/(\d)x(\d\d)/.exec(nested(12, "x"))), nested(30, "\u4e2d").search(/29\u4e2d30/), (nested(5, "ab").slice(2) + nested(3, "cd").slice(1, 5)).match(/b\d[a-d]+/)![0]);

const invalid = /[^\t\x20-\x7e\x80-\xff]/;
const unsafe = /["'&<>]/;
const values = ["text/html", "keep-alive", "12", "Express", "gzip, deflate", "no-cache"];
let total = 0;
const before = entries();
for (let turn = 0; turn < 6000; turn++) {
  const value = values[turn % values.length] + "; q=" + (turn % 10);
  if (invalid.test(value)) total += 1;
  if (invalid.exec(values[turn % values.length] + "-" + turn) !== null) total += 10;
  if (unsafe.test("<" + value)) total += 100;
  if (("a" + value).replace(unsafe, "") === "a" + value) total += 1000;
  if (("b" + value).match(invalid) === null) total += 10000;
}
console.log(total, entries() - before < 600 ? "few entries" : "MANY ENTRIES");
