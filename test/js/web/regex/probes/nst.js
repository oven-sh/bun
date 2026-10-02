const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, str) => { const m = new RegExp(src).exec(str); out((src + " " + s(str)).padEnd(34) + s(m && [...m])); };
t("(?<=$(?:(.?))+?)\\w?", "0"); t("(?<=$(?:x|(.?))+?)\\w?", "0"); t("(?:(a)b){2,}?c", "ababc s"); t("(?:(a)(b)){2,}?x", "ababx s"); t("(?:(a)b){2,3}?y", "ababy s");
