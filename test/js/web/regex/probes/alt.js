const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const re = () => new RegExp("\u{1F600}|-?[_\\w]", "iu");
const inputs = ["\u{1F600}", "a", "-a", "_", "x\u{1F600}", "\u{1F600}\u{1F600}", "", "-", "9", "\u{1F436}", "prefix \u{1F600} suffix"];
for (const inp of inputs) {
  const r = re().exec(inp);
  const all = [...inp.matchAll(new RegExp(re().source, "giu"))].map(m => [m.index, m[0]]);
  out(s(inp).padEnd(28) + " exec=" + s(r && [r.index, r[0]]) + " all=" + s(all));
}
