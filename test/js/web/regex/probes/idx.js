const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, str) => { const m = new RegExp(src, "d").exec(str); out(label.padEnd(26) + s(m && { m: [...m], idx: m.indices })); };
t("(?<=$(.?)+?)", "(?<=$(.?)+?)", "0");
t("(?<=$(.?)+?) inner-cap", "(?<=$((.)?)+?)", "0");
t("(a){1,2}(b){1,2}", "(?<=(a){1,2}(b){1,2})!", "abb!");
t("(a){1,2} alone", "(?<=(a){1,2})b", "aab");
t("(a){1,2} b{1,2}", "(?<=(a){1,2}b{1,2})!", "abb!");
