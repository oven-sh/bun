const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, str) => { try { const m = new RegExp(src).exec(str); out(label.padEnd(24) + s(m && [...m])); } catch (e) { out(label.padEnd(24) + "THREW " + e.message.slice(0,20)); } };
t("(?<=$(.?)+?)", "\\w(?<=$(.?)+?)", "0");      // fails: once + {0,inf} copy
t("(?<=$(.?){1}?)", "\\w(?<=$(.?){1}?)", "0");  // no copy (max==min)
t("(?<=$(.?){1})", "\\w(?<=$(.?){1})", "0");    // greedy, no copy
t("(?<=$(.?){1,2}?)", "\\w(?<=$(.?){1,2}?)", "0"); // once + bounded copy
t("(?<=$(.?)+)", "\\w(?<=$(.?)+)", "0");        // greedy outer
t("(?<=$(0?)+?)", "\\w(?<=$(0?)+?)", "0");        // literal that consumes then gives back
t("(?<=$(0*)+?)", "\\w(?<=$(0*)+?)", "0");
t("(?<=$(?:(.?))+?)", "\\w(?<=$(?:(.?))+?)", "0");
t("(?<=$(.)?)", "\\w(?<=$(.)?)", "0");          // no inner give-back needed?
