const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}\u{1F600}";
const run = (src, fl) => { const re = new RegExp(src, fl); const idx = []; let m, n = 0;
  while ((m = re.exec(G)) !== null && n++ < 8) { idx.push(m.index); if (m[0] === "") re.lastIndex++; }
  out(("/" + src + "/" + fl).padEnd(16) + s(idx)); };
for (const fl of ["gv","gvi","gvm","gvs","gvim","gvis","gvms","gvims","gu","gus","gum","gui"]) run("(?!.)", fl);
run("(?!x)", "gvs"); run("(?!x)", "gv"); run("(?=[^]*)", "gvs"); run("$", "gvs"); run("(?![^])", "gv");
