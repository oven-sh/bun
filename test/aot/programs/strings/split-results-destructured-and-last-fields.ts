// More ways to take the result of split() apart without making it: array patterns, the last field, separators of several characters.
// CALLS- pair StringSplitString
// CALLS- skipping StringSplitString
// CALLS- withDefaults StringSplitString
// CALLS- popped StringSplitString
// CALLS- lastByLength StringSplitString
// CALLS- lastByAt StringSplitString
// CALLS- longSeparator StringSplitString
// CALLS+ longSeparator FindLongSeparators8
// CALLS- lastOfLong StringSplitString
// CALLS+ poppedThenRead StringSplitString
// CALLS+ poppedTwice StringSplitString
// CALLS+ poppedInLoop StringSplitString
// CALLS+ secondToLast StringSplitString
// CALLS+ atVariable StringSplitString
// CALLS+ emptySeparator StringSplitString
// CALLS+ wideSeparator StringSplitString
let guard = 0;
function pair(line: string): string { if (guard > 1e9) pair(line + "x"); const [a, b] = line.split(":"); return b + "<" + a; }
function skipping(line: string): string { if (guard > 1e9) skipping(line + "x"); const [, , c, d] = line.split(","); return c + "<" + d + "<" + Number(c); }
function withDefaults(line: string): string { if (guard > 1e9) withDefaults(line + "x"); const [a = "A", b = "B", c = "C"] = line.split(","); return a + b + c; }
function popped(line: string): string { if (guard > 1e9) popped(line + "x"); return "" + line.split("/").pop(); }
function lastByLength(line: string): string { if (guard > 1e9) lastByLength(line + "x"); const parts = line.split("/"); return parts[parts.length - 1] + "#" + parts.length + "#" + parts[0]; }
function lastByAt(line: string): string { if (guard > 1e9) lastByAt(line + "x"); const parts = line.split("."); return parts.at(-1) + "#" + parts[1]; }
function longSeparator(line: string): string { if (guard > 1e9) longSeparator(line + "x"); const parts = line.split(", "); return parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts.length; }
function lastOfLong(line: string): string { if (guard > 1e9) lastOfLong(line + "x"); return "" + line.split("::").pop(); }
function overlapping(line: string): string { if (guard > 1e9) overlapping(line + "x"); const parts = line.split("aa"); return parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts.length + "|" + parts[parts.length - 1]; }
function withRest(line: string): string { if (guard > 1e9) withRest(line + "x"); const [head, ...tail] = line.split(" "); return head + tail.length; }
function poppedThenRead(line: string): string { if (guard > 1e9) poppedThenRead(line + "x"); const parts = line.split("/"); const last = parts.pop(); return last + "#" + parts.length + "#" + parts[0]; }
function poppedTwice(line: string): string { if (guard > 1e9) poppedTwice(line + "x"); const parts = line.split("/"); return parts.pop() + "#" + parts.pop(); }
function poppedInLoop(line: string): string { if (guard > 1e9) poppedInLoop(line + "x"); const parts = line.split("/"); let out = ""; let part: string | undefined; while ((part = parts.pop()) !== undefined) out += "<" + part + ">"; return out; }
function secondToLast(line: string): string { if (guard > 1e9) secondToLast(line + "x"); const parts = line.split("/"); return "" + parts[parts.length - 2]; }
function atVariable(line: string, k: number): string { if (guard > 1e9) atVariable(line + "x", k); return "" + line.split("/").at(k); }
function iterated(line: string): string { if (guard > 1e9) iterated(line + "x"); let out = ""; for (const part of line.split(",")) out += "[" + part + "]"; return out; }
function emptySeparator(line: string): string { if (guard > 1e9) emptySeparator(line + "x"); const parts = line.split(""); return parts[0] + "|" + parts[1] + "|" + parts.length; }
function wideSeparator(line: string): string { if (guard > 1e9) wideSeparator(line + "x"); const parts = line.split("é"); return parts[0] + "|" + parts[1] + "|" + parts.length; }
function otherLength(line: string, other: string[]): string { if (guard > 1e9) otherLength(line + "x", other); const parts = line.split("/"); return "" + parts[other.length - 1]; }
const lines = ["", "a", "a:b", "a:b:c", ":", "::", ":::", "::::", "a:::b", "a::b:::", "a::b::c", "x/y/z", "/", "x/", "/x", "1,2,3,4,5", ",,", "a, b, c", ", ", "a,b", "aaa", "aaaa", "baab", "aa", "a.b.c", ".", "é/日本/ü", "日::本", "é, è", "a b c", "héllo"];
let out = "";
for (const line of lines) {
  const rope = line + "/" + line.length;
  const part = ("<<" + line + ">>").slice(2, -2);
  for (const subject of [line, rope, part]) {
    out += JSON.stringify(subject) + " " + [pair(subject), skipping(subject), withDefaults(subject), popped(subject), lastByLength(subject), lastByAt(subject), longSeparator(subject), lastOfLong(subject), overlapping(subject), withRest(subject), poppedThenRead(subject), poppedTwice(subject), poppedInLoop(subject), secondToLast(subject), atVariable(subject, -1), atVariable(subject, 1), iterated(subject), emptySeparator(subject), wideSeparator(subject), otherLength(subject, ["", ""])].join(" # ") + "\n";
  }
}
guard += out.length > 1e12 ? 1 : 0;
console.log(out);
export {};
