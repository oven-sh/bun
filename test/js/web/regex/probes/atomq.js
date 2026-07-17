const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, str) => { const m = new RegExp(src).exec(str); out(src.padEnd(24) + s(m && [m.index, ...m])); };
t("(?<=a{2,4})b", "aaaab"); t("(?<=a{2,4}?)b", "aaaab"); t("(?<=[xy]{1,3})z", "xyxz"); t("(?<=\\d{2,3}?)!", "12!");
t("(?<=(a){2,4})b", "aaaab"); t("(?<=(?:xy){1,3})z", "xyxyz");   // parens: now native, no copy
