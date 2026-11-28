const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const G = "\u{1F600}";
const it = (label, src, fl, str) => { try { const re = new RegExp(src, fl); const r = []; let m, n = 0;
  while ((m = re.exec(str)) !== null && n++ < 8) { r.push([m.index, re.lastIndex, m[0]]); if (m[0] === "") re.lastIndex++; }
  out(label.padEnd(40) + s(r)); } catch (e) { out(label.padEnd(40) + "ERR " + e.message.slice(0,30)); } };
// 6049: peel the pattern. Full first, then components. Subject "😀😀", flags gimsv.
it("6049 full", "[.z\\d][^\\dyx-zx]{0}?|(|[éy0-9]((?:\\1)?3{0,2}x|(?<!.+(?:\\1){0}?))?||^\\s{2,}?$){0}?(?!5{0}[y]{2,}|. {0,2}?)", "gimsv", G + G);
it("A: [.z\\d][^\\dyx-zx]{0}?", "[.z\\d][^\\dyx-zx]{0}?", "gimsv", G + G);
it("B: (...){0}?(?!5{0}[y]{2,}|. {0,2}?)", "(|x)(?!5{0}[y]{2,}|. {0,2}?)", "gimsv", G + G);
it("C: (?!. {0,2}?)", "(?!. {0,2}?)", "gimsv", G + G);
it("D: (?!.)", "(?!.)", "gimsv", G + G);
it("E: (?!.)", "(?!.)", "gv", G + G);
it("F: dot alone .", ".", "gsv", G + G);
