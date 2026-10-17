const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, fl, str) => { try { const m = new RegExp(src, fl).exec(str); out((src + " /" + fl + " on " + s(str)).padEnd(58) + s(m && [m.index, [...m]])); } catch (e) { out((src + " /" + fl).padEnd(58) + "ERR " + e.message.slice(0,40)); } };
// 6023 shrink: forward reference \1 to enclosing group, quantified, in a lookahead body
t("(?=^|Ω|\\t[\\s\\w])((?:\\1){2,}?.{2}\\W{0,2}|.(?!d{2,}?)|\\t+(?:\\1)??)", "v", "ab");
t("((?:\\1){2,}?.{2}|x)", "v", "ab");
t("((?:\\1){2,}.{2}|x)", "v", "ab");
t("((?:\\1){2,}?ab)", "", "ab");
t("((?:\\1){2,}ab)", "", "ab");
t("((?:\\1)?ab)", "", "ab");
t("((?:\\1){0,3}ab)", "", "ab");
t("(\\1{2,}?ab)", "", "ab");
t("((?:\\1){2,}?a)", "", "a");
t("(?:(?:\\1){2,}?)(a)", "", "aa");
t("(a(?:\\1)?)", "", "aa");
