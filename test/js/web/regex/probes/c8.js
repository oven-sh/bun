const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, fl, str) => { try { const m = new RegExp(src, fl).exec(str); out(label.padEnd(40) + s(m && [...m])); } catch (e) { out(label.padEnd(40) + "THREW " + e.message.slice(0,30)); } };
// third top-level alternative is the one that matched "0": \w{1,3}(?<=$([\-a-fx-z]|.{1,3}?|){1,3}?)
t("full", "x{1,3}(?<grp>.((?:\\2)\\d{1,3}|(?=(?:\\1)+)(?<!|(?<!a)[\\da-fyy]?)\\w|.??\\S|[b\\d]:{0}\\d))(?:\\2)|\\w{1,3}(?<=$([\\-a-fx-z]|.{1,3}?|){1,3}?)", "s", "0");
t("alt3 only", "\\w{1,3}(?<=$([\\-a-fx-z]|.{1,3}?|){1,3}?)", "s", "0");
t("A (?<=$(a|.?|){1,3}?)", "\\w(?<=$(a|.?|){1,3}?)", "s", "0");
t("B (?<=$(a|.?|)+?)", "\\w(?<=$(a|.?|)+?)", "s", "0");
t("C (?<=$(a|.?|)?)", "\\w(?<=$(a|.?|)?)", "s", "0");
t("D (?<=$(a|.?|){0,3})", "\\w(?<=$(a|.?|){0,3})", "s", "0");
t("E (?<=$(a|)?)", "\\w(?<=$(a|)?)", "s", "0");
t("F (?<=$(a|.?)?)", "\\w(?<=$(a|.?)?)", "s", "0");
t("G (?<=$(a|.?|)?) no-s", "\\w(?<=$(a|.?|)?)", "", "0");
t("H (?<=(a|.?|)?$)", "\\w(?<=(a|.?|)?$)", "s", "0");
