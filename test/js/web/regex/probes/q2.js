const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, fl, str) => { const m = new RegExp(src, fl).exec(str); out(label.padEnd(34) + s(m && [...m])); };
t("10076 exact", "(y{1,3}\\w){2,}?\\w|y{0,2}7", "iv", "prefix yyyy9 suffix");
t("no /iv", "(y{1,3}\\w){2,}?\\w|y{0,2}7", "", "prefix yyyy9 suffix");
t("/i only", "(y{1,3}\\w){2,}?\\w|y{0,2}7", "i", "prefix yyyy9 suffix");
t("/v only", "(y{1,3}\\w){2,}?\\w|y{0,2}7", "v", "prefix yyyy9 suffix");
t("/u only", "(y{1,3}\\w){2,}?\\w|y{0,2}7", "u", "prefix yyyy9 suffix");
t("alt1 alone /iv", "(y{1,3}\\w){2,}?\\w", "iv", "prefix yyyy9 suffix");
t("no alt2 /iv", "(y{1,3}\\w){2,}?\\w", "iv", "yyyy9");
