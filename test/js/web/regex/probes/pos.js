const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const t = (label, re, str) => { const m = re.exec(str); out(label.padEnd(30) + s(m && [m.index, m[0]])); };
// sticky at 1: isolate the position
const y1 = /(?<=(?=^)a)b/y; y1.lastIndex = 1; t("sticky@1 (?<=(?=^)a)b", y1, "ab");
const y2 = /(?<=(?!^)a)b/y; y2.lastIndex = 1; t("sticky@1 (?<=(?!^)a)b", y2, "ab");
// remove the lookahead entirely / vary body
t("(?<=(?:^)a)b non-assert grp", /(?<=(?:^)a)b/, "ab");
t("(?<=^a)b plain", /(?<=^a)b/, "ab");
t("(?<=(?=^)a)b", /(?<=(?=^)a)b/, "ab");
t("(?<=a(?=^)?)b hmm", /(?<=(?=^)?a)b/, "ab");
t("(?<=(?<=^)a)b lb-in-lb", /(?<=(?<=^)a)b/, "ab");
t("(?<=(?=^)a)b at 3", /(?<=(?=^)a)b/, "\nab");
t("(?<=(?=^)a)b at 3 /m", /(?<=(?=^)a)b/m, "\nab");
