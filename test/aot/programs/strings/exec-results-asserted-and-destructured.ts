// A result of exec() or match() that is asserted not to be null, or taken apart by an array pattern, is not made either.
// CALLS- asserted RegExpExec
// CALLS+ asserted RegExpFind
// CALLS- assertedAtEachUse RegExpExec
// CALLS- optionalRead RegExpExec
// CALLS- byPattern RegExpExec
// CALLS+ byPatternWithGaps RegExpExec
// CALLS- assertedPattern RegExpExec
// CALLS- assertedMatch StringMatchRegExp
// CALLS+ orEmpty StringMatchRegExp
// CALLS+ patternWithRest RegExpExec
let guard = 0;
function tried(f: () => string): string { try { return f(); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
function asserted(line: string): string { if (guard > 1e9) asserted(line + "x"); const m = /(\d+)-(\w+)/.exec(line)!; return m[1] + "|" + m[2] + "|" + m.index + "|" + m.length; }
function assertedAtEachUse(line: string): string { if (guard > 1e9) assertedAtEachUse(line + "x"); const m = /(\d+)-(\w+)/.exec(line); return m![1]! + "|" + m![2]! + "|" + Number(m![1]); }
function optionalRead(line: string): string { if (guard > 1e9) optionalRead(line + "x"); return /(\d+)-(\w+)/.exec(line)?.[2] + "|" + /(\d+)-(\w+)/.exec(line)?.index; }
function byPattern(line: string): string { if (guard > 1e9) byPattern(line + "x"); const m = /(\d+)-(\w+)(!)?/.exec(line); if (!m) return "none"; const [whole, a, b, c] = m; return whole + "|" + a + "|" + b + "|" + c; }
function byPatternWithGaps(line: string): string { if (guard > 1e9) byPatternWithGaps(line + "x"); const m = /(\d+)-(\w+)(!)?/.exec(line); if (!m) return "none"; const [whole, a, , c = "C"] = m; return whole + "|" + a + "|" + c; }
function assertedPattern(line: string): string { if (guard > 1e9) assertedPattern(line + "x"); const [, a, b] = /(\d+)-(\w+)/.exec(line)!; return a + "|" + b; }
function assertedMatch(line: string): string { if (guard > 1e9) assertedMatch(line + "x"); const m = line.match(/(\w)=(\w)?/)!; return m[1] + "|" + m[2] + "|" + m.input; }
function orEmpty(line: string): string { if (guard > 1e9) orEmpty(line + "x"); const [, a, b] = line.match(/(\d+)-(\w+)/) ?? []; return a + "|" + b; }
function castToOther(line: string): string { if (guard > 1e9) castToOther(line + "x"); const m = /(\d+)/.exec(line) as unknown as { length: number } | null; return m ? "" + m.length : "none"; }
function patternWithRest(line: string): string { if (guard > 1e9) patternWithRest(line + "x"); const m = /(\d)(\d)(\d)/.exec(line); if (!m) return "none"; const [, ...digits] = m; return digits.join("+"); }
const lines = ["12-ok", "7-no!", "zz", "", "a=b", "k=", "123", "日本12-ok", "9-é", "x=日"];
let out = "";
for (const line of lines) {
  const rope = line + "-" + line.length;
  const part = ("<<" + line + ">>").slice(2, -2);
  for (const subject of [line, rope, part]) {
    out += JSON.stringify(subject) + " " + [tried(() => asserted(subject)), tried(() => assertedAtEachUse(subject)), optionalRead(subject), byPattern(subject), byPatternWithGaps(subject), tried(() => assertedPattern(subject)), tried(() => assertedMatch(subject)), orEmpty(subject), castToOther(subject), patternWithRest(subject)].join(" # ") + "\n";
  }
}
guard += out.length > 1e12 ? 1 : 0;
console.log(out);
export {};
