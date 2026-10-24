// String methods whose operands are all constants are evaluated while the program is built. The answers, and what a call leaves in a regular expression that is kept, are plain Bun's.
const out: unknown[] = [];

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ESCAPED = escapeForPattern("a.b*c");
const built = new RegExp(`^${ESCAPED}$`);
out.push(ESCAPED, built.source, built.test("a.b*c"), built.test("aXbc"));

out.push("  padded ".trim(), " x".trimStart(), "x ".trimEnd(), "abcdef".slice(1, -1), "abcdef".substring(4, 1), "abcdef".substr(-3, 2));
out.push("abc".at(-1), "abc".at(5), "abc".charAt(1), "abc".charAt(9), "abc".charCodeAt(1), "abc".charCodeAt(9), "a😀".codePointAt(1), "a😀".codePointAt(9));
out.push("a".concat("b", "c"), "abcabc".indexOf("c"), "abcabc".indexOf("c", 3), "abcabc".lastIndexOf("a"), "abc".includes("bc"), "abc".startsWith("b", 1), "abc".endsWith("b", 2));
out.push("a-b-c".replace("-", "+"), "a-b-c".replaceAll("-", "+"), "x".replace("x", "$$"), "é-日本-😀".replaceAll("-", "😀"));
out.push("a-b-c".replace(/-/g, "$&$&"), "a-b-c".replace(/(?<dash>-)/, "[$<dash>]"), "a-b-c".replaceAll(/-/g, "$`"), "ABC".replace(/b/i, "$'"), "abc".search(/c/), "abc".search(/z/));

// A regular expression that is kept shows what each call leaves in lastIndex.
const everyMatch = /b/g;
everyMatch.lastIndex = 2;
out.push("abcabc".replace(everyMatch, "B"), everyMatch.lastIndex);
const atLastIndex = /b/y;
atLastIndex.lastIndex = 1;
out.push("abcabc".replace(atLastIndex, "B"), atLastIndex.lastIndex, "abcabc".replace(atLastIndex, "B"), atLastIndex.lastIndex);
const firstMatch = /b/;
firstMatch.lastIndex = 5;
out.push("abcabc".replace(firstMatch, "B"), firstMatch.lastIndex, "abcabc".search(firstMatch), firstMatch.lastIndex);

// A call that throws when the program runs still throws there.
const attempts: (() => unknown)[] = [
  () => "abc".replaceAll(/b/, "x"),
  () => "abc".startsWith(/b/ as unknown as string),
  () => "abc".includes(/b/ as unknown as string),
  () => "abc".endsWith(/b/ as unknown as string),
];
for (const attempt of attempts) {
  try {
    out.push(attempt());
  } catch (error) {
    out.push((error as Error).name);
  }
}

// An operand that runs code is no constant.
out.push("abc".replace(/b/, match => match.toUpperCase()));
out.push("abc".replace("b", { toString() { out.push("asked"); return "B"; } } as unknown as string));

// The text of a pattern may be longer than any other string that the build computes.
const P0 = "[a-z0-9_]?";
const P1 = `${P0}${P0}`;
const P2 = `${P1}${P1}`;
const P3 = `${P2}${P2}`;
const P4 = `${P3}${P3}`;
const P5 = `${P4}${P4}`;
const P6 = `${P5}${P5}`;
const P7 = `${P6}${P6}`;
const P8 = `${P7}${P7}`;
const P9 = `${P8}${P8}`;
const P10 = `${P9}${P9}`;
const P11 = `${P10}${P10}`;
const P12 = `${P11}${P11}`;
const P13 = `${P12}${P12}`;
const long = new RegExp(`^${P13}$`);
out.push(long.source.length, long.test("abc"), long.test("-"));

const Q13 = `${P12}-${P12}`;
const alsoMeasured = new RegExp(`^${Q13}$`);
out.push(Q13.length, Q13.indexOf("-"), alsoMeasured.test("ab-c"), alsoMeasured.test(""));

console.log(out.map(String).join(" | "));
