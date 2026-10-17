// s.replace(/a/g, "..").replace(/b/g, "..") ..: chains of global patterns of one character with constant replacements. Which chains may be done in one pass over the string and which may not; each is checked against the same steps done one at a time through variables that are used twice, and against what RegExp's legacy static properties say afterwards.
const report: string[] = [];
let wrong = 0;
const legacy = RegExp as unknown as Record<string, string>;
function left(): string {
  return JSON.stringify([legacy.lastMatch, legacy.input, legacy.leftContext, legacy.rightContext, legacy["$&"], legacy.$1]);
}
function reset(): void {
  /^mark$/.test("mark");
}

function forShell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/ /g, "\\ ").replace(/\t/g, "\\t");
}
function forShellStepByStep(text: string): string {
  const one = text.replace(/\\/g, "\\\\");
  const two = one.replace(/'/g, "\\'");
  const three = two.replace(/ /g, "\\ ");
  return [one, two, three].length === 3 ? three.replace(/\t/g, "\\t") : one;
}
function toPath(text: string): string {
  return text.replace(/\./g, "/").replace(/\$/g, "_inner_");
}
function toPathStepByStep(text: string): string {
  const one = text.replace(/\./g, "/");
  return one.length >= 0 ? one.replace(/\$/g, "_inner_") : one;
}
function squash(text: string): string {
  return text.replace(/,/g, "").replace(/;/g, " ").replace(/ /g, "");
}
function eachFeedsTheNext(text: string): string {
  return text.replace(/p/g, "q").replace(/q/g, "r").replace(/r/g, "p");
}
function withReferences(text: string): string {
  return text.replace(/u/g, "<$&>").replace(/v/g, "$$").replace(/w/g, "W");
}
function withOtherPatterns(text: string): string {
  return text.replace(/k/gi, "1").replace(/l/, "2").replace(/m/g, "3").replace(/n/g, "4").replace(/oo/g, "5").replace(/[st]/g, "6");
}
function sameCharacterTwice(text: string): string {
  return text.replace(/e/g, "E").replace(/e/g, "never").replace(/z/g, "e");
}
function middleIsKept(text: string): string {
  const middle = text.replace(/\+/g, " plus ");
  return middle.replace(/-/g, " minus ") + "|" + middle.length;
}
function tenSteps(text: string): string {
  return text.replace(/a/g, "0").replace(/b/g, "1").replace(/c/g, "2").replace(/d/g, "3").replace(/e/g, "4").replace(/f/g, "5").replace(/g/g, "6").replace(/h/g, "7").replace(/i/g, "8").replace(/j/g, "9");
}

const texts: string[] = ["", "nothing to do", "\\", "'", " ", "\t", "it's a 'test'\tof\\paths", "   ", "\\\\''", "na\u00efve caf\u00e9 's", "\u4e2d\u6587 it's", "end\\", "'start", "m".repeat(90) + "'" + "n".repeat(90) + " "];
for (let i = 0; i < 5; i++) texts.push(texts[i + 5]! + "/" + texts[(i * 3) % 7]! + texts[6]!.slice(i, i + 9));
for (let turn = 0; turn < 3; turn++)
  for (const text of texts) {
    reset();
    const fused = forShell(text);
    const after = left();
    reset();
    if (fused !== forShellStepByStep(text) || after !== left()) wrong++;
    reset();
    const path = toPath(text + ".a$b.");
    const afterPath = left();
    reset();
    if (path !== toPathStepByStep(text + ".a$b.") || afterPath !== left()) wrong++;
    if (turn === 2 && text.length < 24) report.push(JSON.stringify(fused) + " " + after);
  }
for (const text of ["a,b;c d,,e", "pqr rqp", "uvw wvu", "KkLlMmNnoo sstt klmn", "eze zez", "1+2-3+4", "abcdefghij jihgfedcba k"]) {
  reset();
  report.push([squash(text), eachFeedsTheNext(text), withReferences(text), withOtherPatterns(text), sameCharacterTwice(text), middleIsKept(text), tenSteps(text)].join(" | ") + " " + left());
}
for (const absent of [undefined, null] as unknown as string[]) {
  try {
    report.push(forShell(absent));
  } catch (problem) {
    report.push((problem as Error).name);
  }
}
report.push("wrong " + wrong);
console.log(report.join("\n"));
