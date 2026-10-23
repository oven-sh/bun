const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, str) => { const m = new RegExp(src).exec(str); out((src + " " + s(str)).padEnd(38) + s(m && [...m])); };
t("(?<=(ab){2,3})!", "xabab!q"); t("(?<=(ab){2,3}?)!", "abababab! q"); t("(?<=(y{1,2}\\w){2,}?)!", "yyyy9! s");
t("(?<=(a){2,})b", "aaab s"); t("(?<=(a){2,}?)b", "aaab s"); t("(?<=(a){2}(b))!", "aab! z");
