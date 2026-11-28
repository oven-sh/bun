const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src) => { try { const m = new RegExp(src).exec("abcd"); out(src.padEnd(22) + s(m && [m.index, m[0]])); } catch (e) { out(src.padEnd(22) + "THREW " + e.message.slice(0,50)); } };
t("(?<=abc)d"); t("(?<=abc(?=d))d"); t("(?<=(?=a)abc)d"); t("(?<=a(?=b)bc)d"); t("(?<=(?=(\\w))\\w{3})d");
