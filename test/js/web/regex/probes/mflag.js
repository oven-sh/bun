const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const G = "\u{1F600}\u{1F600}";
const it = (fl) => { const re = new RegExp("(?!.)", fl); const r = []; let m, n = 0;
  while ((m = re.exec(G)) !== null && n++ < 8) { r.push(m.index); if (m[0] === "") re.lastIndex++; } out(("/(?!.)/" + fl).padEnd(14) + s(r)); };
for (const f of ["g","gv","gu","gm","gvm","gs","gvs","gvms","gy","gvy"]) it(f);
