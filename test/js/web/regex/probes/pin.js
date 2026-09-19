const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, str) => { const m = new RegExp(src, "d").exec(str); out(label.padEnd(26) + s(m && { m: [...m], i: m.indices })); };
t("A $(.?)+?", "(?<=$(.?)+?)", "0");
t("B ^(.?)+? on ''-ish", "(?<=^(.?)+?)\\d", "0");   // ^ instead of $ (anchor at other end)
t("C (.?)+?  no anchor", "(?<=(.?)+?)\\d", "0");
t("D $(.?)+? then more", "\\d(?<=$(.?)+?\\d)", "0");
t("E \\b(.?)+?", "(?<=\\b(.?)+?)\\d", "0");
t("F $(.?)*?", "(?<=$(.?)*?)", "0");
t("G $(.?)+ greedy", "(?<=$(.?)+)", "0");
t("H $ (.?)+? spaced", "(?<=$(?:(.?))+?)", "0");
