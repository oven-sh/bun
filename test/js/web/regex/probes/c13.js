const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, src, str) => { try { const m = new RegExp(src).exec(str); out(label.padEnd(28) + s(m && [...m])); } catch (e) { out(label.padEnd(28) + "THREW"); } };
// FORWARD analogues: once + {0,inf} copy, copy runs an iteration that gets unwound, then once must re-record.
t("fwd ^(0?)+?$", "^(0?)+?$", "0");
t("fwd (0?)+?(?=0)", "(0?)+?(?=0)0", "0");
t("fwd (0?)+?0$", "(0?)+?0$", "0");
t("fwd a(x?)+?a", "a(x?)+?a", "aa");
t("fwd a(x*)+?a", "a(x*)+?a", "aa");
t("fwd (0*)+?0", "^(0*)+?0$", "00");
// the mirrored one again + a sibling with content after
t("bwd $(.?)+?", "\\w(?<=$(.?)+?)", "0");
t("bwd (?<=$(.?)+?)!", "!(?<=(.?)+?!)", "0!");
