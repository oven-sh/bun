const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, fl, str) => { try { const m = new RegExp(src, fl).exec(str); out(label.padEnd(34) + s(m && [...m])); } catch (e) { out(label.padEnd(34) + "THREW"); } };
t("(?<=$(a|.?|)+?) s", "\\w(?<=$(a|.?|)+?)", "s", "0");
t("(?<=$(a|)+?)", "\\w(?<=$(a|)+?)", "", "0");
t("(?<=$(|a)+?)", "\\w(?<=$(|a)+?)", "", "0");
t("(?<=$(a|.?)+?)", "\\w(?<=$(a|.?)+?)", "", "0");
t("(?<=$(a|b|)+)", "\\w(?<=$(a|b|)+)", "", "0");   // greedy sibling
t("(?<=$(a|b|){1}) ", "\\w(?<=$(a|b|){1})", "", "0"); // exactly one
t("(?<=$(a|b|){2,}?)", "\\w(?<=$(a|b|){2,}?)", "", "0");
t("no-anchor (?<=(a|)+?)", "\\w(?<=(a|)+?)", "", "0");
t("fwd (a|)+?$", "\\w?(a|)+?$", "", "0");
t("fwd $(a|)+?", "^\\w$(a|)+?", "", "0");
