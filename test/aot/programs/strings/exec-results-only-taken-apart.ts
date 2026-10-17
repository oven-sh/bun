// The array that exec() or match() returns is not made where the program only tests it for null and reads groups at constant indices, index, input and the length.
// CALLS- parsed RegExpExec
// CALLS+ parsed RegExpFind
// CALLS- truthy RegExpExec
// CALLS- inLoop RegExpExec
// CALLS- properties RegExpExec
// CALLS+ returned RegExpExec
// CALLS+ handedOn RegExpExec
// CALLS+ byVariable RegExpExec
// CALLS+ written RegExpExec
// CALLS+ named RegExpExec
// CALLS+ comparedWithObject RegExpExec
// CALLS- destructured RegExpExec
// CALLS- viaMatch StringMatchRegExp
// CALLS+ viaMatch RegExpFind
// CALLS+ globalMatch StringMatchRegExp
// CALLS+ matchOfGivenPattern StringMatchRegExp
// CALLS+ matchOfPatternUsedTwice StringMatchRegExp
// CALLS+ matchReturned StringMatchRegExp
// CALLS+ untypedResult RegExpExec
// CALLS+ untypedMatch StringMatchRegExp
let guard = 0;
function parsed(line: string): string {
  if (guard > 1e9) parsed(line + "x");
  const m = /^(\d+)-(\w+)(?:-(\d+))?$/.exec(line);
  if (m === null) return "null";
  let total = Number(m[1]);
  if (m[2] === "ok") total += 1000;
  if (m[3] !== undefined) total += parseInt(m[3], 10);
  return total + ":" + m.index + ":" + m[0].length + ":" + Number(m[3]) + ":" + m[2].charCodeAt(0) + ":" + typeof m[3] + ":" + typeof m[4] + ":" + Number(m[9]);
}
function truthy(line: string): string {
  if (guard > 1e9) truthy(line + "x");
  const m = /(\w+)=(\w*)/.exec(line);
  if (!m) return "none";
  return m[1] + ":" + m[2] + ":" + m[2].length;
}
function inLoop(text: string): string {
  const re = /(\d+)(,|;)/g;
  let m: RegExpExecArray | null;
  let sum = 0;
  let places = "";
  while ((m = re.exec(text)) !== null) { sum += Number(m[1]); places += m.index + m[2] + re.lastIndex + " "; }
  return sum + " " + places + re.lastIndex;
}
function properties(line: string): string {
  if (guard > 1e9) properties(line + "x");
  const m = /b(c*)(z)?/.exec(line);
  if (m == null) return "null " + RegExp.lastMatch;
  return [m.index, m.input, m.length, m[0], m[1], m[2], RegExp.lastMatch, RegExp.$1, RegExp.leftContext, RegExp.rightContext].join("|");
}
function twice(a: string, b: string): string {
  if (guard > 1e9) twice(a + "x", b);
  const re = /(\w)(\w)/;
  const first = re.exec(a);
  const second = re.exec(b);
  if (!first || !second) return "null";
  return first[1] + first[2] + second[1] + second[2] + first.index + second.index;
}
function sticky(text: string): string {
  const re = /a(b)?/y;
  let out = "";
  for (let i = 0; i < 5; i++) { const m = re.exec(text); out += (m ? m[0] + "," + m[1] + "," + m.index : "null") + "@" + re.lastIndex + " "; }
  return out;
}
function thrown(line: string): string {
  if (guard > 1e9) thrown(line + "x");
  const m = /q(\d)/.exec(line);
  try { return m![1] + m!.index; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }
}
function frozenLastIndex(text: string): string {
  const re = /a/g;
  Object.defineProperty(re, "lastIndex", { writable: false, value: 0 });
  try { const m = re.exec(text); return m ? m[0] : "null"; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }
}
function objectLastIndex(text: string): string {
  const re = /a(.)/g;
  let asked = 0;
  (re as { lastIndex: unknown }).lastIndex = { valueOf() { asked++; return 2; } };
  const m = re.exec(text);
  return (m ? m[1] + m.index : "null") + asked + re.lastIndex;
}
function returned(line: string): RegExpExecArray | null { if (guard > 1e9) returned(line + "x"); const m = /(\d)(\d)/.exec(line); if (m && m[1] === "9") guard++; return m; }
function look(list: string[] | null): number { if (guard > 1e9) look(list); return list ? list.length : -1; }
function handedOn(line: string): number { if (guard > 1e9) handedOn(line + "x"); const m = /(\d)(\d)/.exec(line); return look(m) + (m ? Number(m[1]) : 0); }
function byVariable(line: string, k: number): string { if (guard > 1e9) byVariable(line + "x", k); const m = /(\d)(\d)/.exec(line); return m ? m[k] + m[0] : "null"; }
function written(line: string): string { if (guard > 1e9) written(line + "x"); const m = /(\d)(\d)/.exec(line); if (!m) return "null"; m[1] = "w"; return m[1] + m[2]; }
function named(line: string): string { if (guard > 1e9) named(line + "x"); const m = /(?<a>\d)(?<b>\d)/.exec(line); return m ? m.groups!.a + m[2] : "null"; }
const held: object[] = [/x/];
function comparedWithObject(line: string): string { if (guard > 1e9) comparedWithObject(line + "x"); const re = /(\d)/; held[0] = re; const m: object | null = re.exec(line); return String(m === held[0]) + String(m === null); }
function destructured(line: string): string { if (guard > 1e9) destructured(line + "x"); const m = /(\d)(\d)/.exec(line); if (!m) return "null"; const [whole, a, b] = m; return whole + a + b; }
function namedButByIndex(line: string): string { if (guard > 1e9) namedButByIndex(line + "x"); const m = /(?<a>\d)(?<b>x)?/.exec(line); return m ? m[1] + m[2] + m.index : "null"; }
function viaMatch(line: string): string { if (guard > 1e9) viaMatch(line + "x"); const m = line.match(/(\d)(\w)?/); return m ? Number(m[1]) + ":" + m[2] + ":" + m.index + ":" + m.length + ":" + RegExp.lastMatch : "null"; }
function stickyMatch(line: string): string { if (guard > 1e9) stickyMatch(line + "x"); const m = line.match(/a(b)?/y); return m ? m[0] + m[1] + m.index : "null"; }
function globalMatch(line: string): string { if (guard > 1e9) globalMatch(line + "x"); const m = line.match(/\w/g); return m ? m[0] + m[1] + m.length : "null"; }
function matchOfGivenPattern(line: string, re: RegExp): string { if (guard > 1e9) matchOfGivenPattern(line + "x", re); const m = line.match(re); return m ? m[0] + m.length : "null"; }
function matchOfPatternUsedTwice(line: string): string { if (guard > 1e9) matchOfPatternUsedTwice(line + "x"); const re = /(\w)/; (re as { exec: unknown }).exec = () => null; const m = line.match(re); return m ? m[0] : "null"; }
function matchReturned(line: string): RegExpMatchArray | null { if (guard > 1e9) matchReturned(line + "x"); const m = line.match(/(\w)(\w)/); if (m && m[1] === "~") guard++; return m; }
function untypedResult(line: string): string { if (guard > 1e9) untypedResult(line + "x"); const m: any = /(\w)(\d)?/.exec(line); if (m === null) return "null"; return m[0] + m[1] + m[2] + m.index; }
function untypedMatch(line: string): string { if (guard > 1e9) untypedMatch(line + "x"); const re: any = /(\w)(\d)?/; const m: any = line.match(re); return m == null ? "null" : m[1] + m[2]; }
function untypedThrows(line: string): string { const m: any = /q(\d)/.exec(line); try { return m[1] + m.index; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
function* between(line: string): Generator<string> { const m = /(\w)(\w)/.exec(line); if (!m) return; yield m[1]; /zz/.exec("zz"); yield m[2]; yield String(m.index); }
async function later(line: string): Promise<string> { const m = /(\w)-(\w)/.exec(line); if (!m) return "null"; const a = m[1]; await null; /(q)/.exec("q"); return a + m[2] + m.index; }
const lines = ["12-ok", "7-no-5", "zz", "", "a=b", "key=", "?", "abcc", "xbz", "b", "1,22;333,", "日本12-ok", "é=è", "99", "q7", "ab", "aabab", "12-ok-034", "a-b"];
let out = "";
for (const line of lines) {
  const rope = line + "-" + line.length;
  const part = ("<<" + line + ">>").slice(2, -2);
  for (const subject of [line, rope, part]) {
    out += JSON.stringify(subject) + " " + [parsed(subject), truthy(subject), inLoop(subject), properties(subject), twice(subject, "xy" + subject), sticky(subject), thrown(subject), frozenLastIndex(subject), objectLastIndex(subject), JSON.stringify(returned(subject)), handedOn(subject), byVariable(subject, 2), written(subject), named(subject), comparedWithObject(subject), destructured(subject), namedButByIndex(subject), viaMatch(subject), stickyMatch(subject), globalMatch(subject), matchOfGivenPattern(subject, /b+/), matchOfGivenPattern(subject, /\d/g), matchOfPatternUsedTwice(subject), JSON.stringify(matchReturned(subject)), untypedResult(subject), untypedMatch(subject), untypedThrows(subject), [...between(subject)].join("_")].join(" # ") + "\n";
  }
}
let big = "";
for (let i = 0; i < 3000; i++) big += i + (i % 3 ? "," : ";");
out += inLoop(big).length + "\n";
console.log(out);
function ofNothing(line: string | null | undefined): string { if (guard > 1e9) ofNothing(line + "x"); const m = /(u|n)(\w)/.exec(line as string); return m ? m[1] + m[2] + m.input : "null"; }
console.log(ofNothing(null), ofNothing(undefined), ofNothing("sun"));
console.log(await later("a-b"), await later("zz"));
export {};
