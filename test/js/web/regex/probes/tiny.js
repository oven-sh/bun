const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "😀" + "😀"; // "😀😀" as the harness has it
const cases = [
  ["(?!.)", "givms", G],
  ["(?!😀)", "v", G],
  ["(?!.)", "givms", "aa"],
  ["(?!.)", "gv", G],
  ["(?!.)", "g", G],
  ["(?!.)", "gv", "ab"],
  ["(?=$)", "gv", G],
];
for (const [src, fl, str] of cases) {
  const re = new RegExp(src, fl);
  const idx = [];
  let m, n = 0;
  while ((m = re.exec(str)) !== null && n++ < 6) { idx.push(m.index); if (m[0] === "") re.lastIndex++; if (!re.global) break; }
  out(("/" + src + "/" + fl + " on " + s(str)).padEnd(38) + " match indices: " + s(idx));
}
