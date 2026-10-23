const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const cases = [
  ["(?<!a(?=b(?!\\u00dfc{0,2})))", "", "xx"],
  ["(?<!a(?=b(?!c{0,2})))", "", "xx"],
  ["(?<=a(?=b(?!c{0,2})))", "", "ab"],
  ["(?<=a(?=b(?!c{0,2})))", "", "abc"],
  ["(?<=a(?=b(?!c{0,2})))d", "", "abd"],
  ["(?<!x(?=y(?=z{1,3}w)))q", "", "q"],
  ["(?<!x(?=y(?=z{1,3}w)))q", "", "xyzzwq"],
  ["(?<=k(?=(?<=k)m{0,2}))m", "", "kmm"],
  ["(?<=a(?=b(?=c{2}(?!d))))b", "", "abccb"],
  ["(?<=a(?=b(?=c{2}(?!d))))b", "", "abccdb"],
  ["a(?<=(?=b{0,3}c)a)bbc", "", "abbc"],
];
for (const [src, f, str] of cases) out((src + " on " + s(str)).padEnd(46) + s(new RegExp(src, f).exec(str)));
