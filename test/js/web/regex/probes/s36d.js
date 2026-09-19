const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const G="\u{1F600}"; const S=G+G;
const g = (label, src, fl) => { try { const re = new RegExp(src, fl); const r=[]; let m,k=0; while ((m = re.exec(S)) !== null && k++ < 10) { r.push(m.index); if (m[0]==="") re.lastIndex++; } out(label.padEnd(30) + s(r)); } catch (e) { out(label.padEnd(30) + "THREW"); } };
g("row A /v", "(?![\\w9A-Z]+|.[0xb]?)|c[[9]&&[\\d]]", "vg");
g("row A /u (no setop)", "(?![\\w9A-Z]+|.[0xb]?)|c[9]", "ug");
g("(?!.)|c /v", "(?!.)|c", "vg");
g("(?!.)|c /u", "(?!.)|c", "ug");
g("(?!.)|😀 /v astral-start alt2", "(?!.)|" + G + "q", "vg");
