const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const G = "😀"; const S = "prefix  " + G + " suffix";
const src = "\\s" + G + "|\\s{0,2}(?!.{1,3}^)\\n";
// sticky at each position 5..9
for (let i = 5; i <= 9; i++) { const re = new RegExp(src, "iuy"); re.lastIndex = i; const m = re.exec(S); out(("sticky @" + i).padEnd(14) + s(m && [m.index, m[0]])); }
// alt1 only sticky @7 and alt2 only sticky @7
{ const re = new RegExp("\\s" + G, "iuy"); re.lastIndex = 7; out("alt1 sticky@7 ".padEnd(14) + s(re.exec(S) && "match")); }
{ const re = new RegExp("\\s{0,2}(?!.{1,3}^)\\n", "iuy"); re.lastIndex = 7; out("alt2 sticky@7 ".padEnd(14) + s(re.exec(S) && "match")); }
// exec from lastIndex 5 (g)
{ const re = new RegExp(src, "iug"); re.lastIndex = 5; const m = re.exec(S); out("g from 5 ".padEnd(14) + s(m && [m.index, m[0]])); }
{ const re = new RegExp(src, "iug"); re.lastIndex = 6; const m = re.exec(S); out("g from 6 ".padEnd(14) + s(m && [m.index, m[0]])); }
{ const re = new RegExp(src, "iug"); re.lastIndex = 7; const m = re.exec(S); out("g from 7 ".padEnd(14) + s(m && [m.index, m[0]])); }
