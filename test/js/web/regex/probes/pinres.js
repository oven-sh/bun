const out = typeof print === "function" ? print : console.log;
const G = "\u{1F600}", D = "\u{1F436}";
const rows = [
  ["class-first-eqmin-lit-astral", G + "|[qz]a", "u", "-" + G],
  ["class-first-eqmin-wordclass",   G + "|\\wa",  "u", "-" + G],
  ["class-first-eqmin-astralclass", "[" + G + D + "]|[qz]a", "u", "-" + G],
  ["class-first-eqmin-v",           G + "|[qz]a", "v", "-" + G],
];
for (const [name, src, fl, s] of rows) {
  const m = new RegExp(src, fl).exec(s);
  out(JSON.stringify({ name, src, fl, s, result: m && { match: [...m], index: m.index } }));
}
