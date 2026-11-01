const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const G = "\u{1F600}\u{1F600}";
const at = (label, src, fl, i) => { const re = new RegExp(src, fl); re.lastIndex = i; const m = re.exec(G); out((label + " @" + i).padEnd(20) + s(m && [m.index, m[0]])); };
// Sticky at each position: does '.' match at a mid-pair position?
for (const i of [0,1,2,3,4]) at(". /vys", ".", "vys", i);
out("---");
for (const i of [0,1,2,3,4]) at(". /vy", ".", "vy", i);
out("---");
for (const i of [1]) { at("[^] /vy", "[^]", "vy", i); at("[\\s\\S] /vy", "[\\s\\S]", "vy", i); at("(?!.) /vys", "(?!.)", "vys", i); at("(?!.) /vy", "(?!.)", "vy", i); }
