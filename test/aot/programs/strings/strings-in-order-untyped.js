// `<`, `<=`, `>` and `>=` on every pair of 30 strings in 6 internal representations, and sorting with them (the same program without type annotations).
// ENV JSC_useDollarVM=1
const wide = (text) => (typeof $vm === "object" ? $vm.make16BitStringIfPossible(text) : ("\u0100" + text).substring(1));
const narrow = (text) => text.split("").join("");
const makers = [narrow, wide, (text) => narrow(text.slice(0, 1)) + narrow(text.slice(1)), (text) => narrow("<" + text + ">").slice(1, -1), (text) => wide("<" + text + ">").slice(1, -1), (text) => narrow(text.slice(0, -1)) + wide(text.slice(-1))];
const texts = ["", "a", "b", "A", "aa", "ab", "a ", "abcdefg", "abcdefgh", "abcdefgi", "abcdefghi", "abcdefghj", "abcdefgh\x00", "abcdefghabcdefgh", "abcdefghabcdefgi", "abcdefghabcdefg", "Abcdefghabcdefgh", "z", "\x7F", "\x80", "\xE9", "\xFF", "z\xFF", "\xFFz", "10", "9", "100", "x".repeat(70), "x".repeat(69) + "y", "x".repeat(71)];
function typed(a, b) {
  return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0);
}
function union(a, b) {
  return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0);
}
function any(a, b) {
  return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0);
}
let sum = 0;
let odd = 0;
const mix = (n) => {
  sum = Math.imul(sum, 31) + n | 0;
};
for (const a of texts)
  for (const b of texts) {
    const first = typed(narrow(a), narrow(b));
    for (const p of makers)
      for (const q of makers) {
        if (a.length < 2 && p !== narrow && p !== wide || b.length < 2 && q !== narrow && q !== wide)
          continue;
        for (const compare of [typed, union, any]) {
          const got = compare(p(a), q(b));
          mix(got);
          if (got !== first || ![3, 10, 12].includes(got))
            odd++;
        }
      }
  }
const beyond = ["\u0100", "\u20AC", "\uD800", "\uD83D\uDE00", "\uFFFF", "a\u0100", "\xFF\u0100"].map(wide);
for (const a of beyond.concat(texts.slice(0, 24).map(narrow)))
  for (const b of beyond) {
    mix(typed(a, b));
    mix(any(b, a));
  }
console.log(union(1, 2), union("1", 2), union(10, "9"), union("10", "9"), union("a", 1), any(null, "a"), any(undefined, "a"), any("a", {}), any([2], "10"), any("1", 1n), any(NaN, "a"), any(true, "0"));
console.log(texts.map(narrow).sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map((t) => t.slice(0, 18)).join("|") === texts.map(wide).sort().map((t) => t.slice(0, 18)).join("|"), odd, sum);
