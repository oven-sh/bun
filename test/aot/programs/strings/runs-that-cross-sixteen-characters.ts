// Runs of a character class at every place round the sixteenth, thirty-second and forty-eighth character of a text: every length from 0 to 70, every start and every length of a single run, and texts woven from two periods. Classes of one to four ranges, of more than four, and their complements; checked against a loop with a predicate.
const report: string[] = [];
let wrong = 0;
const legacy = RegExp as unknown as Record<string, string>;
function byHand(text: string, members: string, isComplement: boolean, inserted: string, joinsRuns: boolean): string {
  let out = "";
  let wasMember = false;
  for (const character of text) {
    const member = members.includes(character) !== isComplement;
    if (!member) out += character;
    else if (!joinsRuns || !wasMember) out += inserted;
    wasMember = member;
  }
  return out;
}
const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const checks: [(text: string) => string, (text: string) => string][] = [
  [text => text.replace(/[A-Z]+/g, "^"), text => byHand(text, upper, false, "^", true)],
  [text => text.replace(/[A-Z]/g, "^"), text => byHand(text, upper, false, "^", false)],
  [text => text.replace(/[^A-Z]+/g, "v"), text => byHand(text, upper, true, "v", true)],
  [text => text.replace(/[A-C.K-M_]+/g, "four"), text => byHand(text, "ABC.KLM_", false, "four", true)],
  [text => text.replace(/[ACEGI]+/g, "5"), text => byHand(text, "ACEGI", false, "5", true)],
  [text => text.replace(/[^ACEGI]+/g, ""), text => byHand(text, "ACEGI", true, "", true)],
  [text => text.replace(/[^]+/g, "*"), text => (text ? "*" : "")],
  [text => text.replace(/[]+/g, "!"), text => text],
];
function verify(text: string): void {
  for (const [replaced, expected] of checks) if (replaced(text) !== expected(text)) wrong++;
}
let texts = 0;
for (let length = 0; length <= 70; length += length < 50 ? 1 : 5)
  for (let start = 0; start <= length; start++)
    for (const size of [0, 1, 2, 15, 16, 17, 33]) {
      if (start + size > length) break;
      verify(".".repeat(start) + "K".repeat(size) + "_".repeat(length - start - size));
      texts++;
    }
for (let first = 1; first <= 9; first++)
  for (let second = 1; second <= 7; second += 2) {
    let text = "";
    for (let i = 0; i < 67; i++) text += i % first === 0 ? "A" : i % second === 0 ? "m" : (i * first) % 5 === 0 ? "G" : ".";
    verify(text);
    texts++;
  }
report.push(texts + " texts, wrong " + wrong);
for (const text of ["ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOPQ", "aBCDEFGHIJKLMNOPQ", "ABCDEFGHIJKLMNOp", "ABCDEFGHIJKLMNOPqRSTUVWXYZABCDEFG", "a".repeat(15) + "Z", "a".repeat(16) + "Z", "a".repeat(15) + "YZ" + "a".repeat(15) + "YZ", "Z" + "a".repeat(30) + "Z"]) {
  const made = text.replace(/[A-Z]+/g, "^");
  report.push(made + " " + [legacy.lastMatch, legacy.leftContext.length, legacy.rightContext.length].join());
}
console.log(report.join("\n"));
