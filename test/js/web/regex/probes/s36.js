const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, fl, str) => { try { const re = new RegExp(src, fl); const m = re.exec(str); out(label.padEnd(38) + s(m && [m.index, ...m])); } catch (e) { out(label.padEnd(38) + "THREW"); } };
const g = (label, src, fl, str) => { try { const re = new RegExp(src, fl); const r=[]; let m,k=0; while ((m = re.exec(str)) !== null && k++ < 10) { r.push(m.index); if (m[0]==="") re.lastIndex++; } out(label.padEnd(38) + s(r)); } catch (e) { out(label.padEnd(38) + "THREW"); } };
t("9036 full", "(?![\\w9A-Z]+|.[0xb]?)|c[[9]&&[\\d]]", "v", "\ud83d\ude00\ud83d\ude00");
g("9036 iterate g", "(?![\\w9A-Z]+|.[0xb]?)|c[[9]&&[\\d]]", "vg", "\ud83d\ude00\ud83d\ude00");
