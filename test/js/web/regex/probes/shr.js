const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const t = (label, src, fl, str) => { try { const re = new RegExp(src, fl); const idx = []; let m, n = 0;
  while ((m = re.exec(str)) !== null && n++ < 20) { idx.push(m.index); if (m[0] === "") re.lastIndex++; }
  out(label.padEnd(46) + s(idx)); } catch (e) { out(label.padEnd(46) + "ERR " + e.message.slice(0,30)); } };
const S = "prefix yaa suffix";
// 6003 shrink: original has three top-level alternatives; the third is (?<=...)?
t("full-3rd  (?<=\\b(?:^|(?:(?=a)y|\\W??b3|\\W??|.?)+?|)?)", "(?<=\\b(?:^|(?:(?=a)y|\\W??b3|\\W??|.?)+?|)?)", "g", S);
t("(?<=\\b(?:.?)+?|)?", "(?<=\\b(?:.?)+?|)?", "g", S);
t("(?<=(?:.?)+?)?", "(?<=(?:.?)+?)?", "g", S);
t("(?<=(?:.?)+?)", "(?<=(?:.?)+?)", "g", S);
t("(?<=(?:.)+?)", "(?<=(?:.)+?)", "g", S);
t("(?<=(?:x?)+?)?", "(?<=(?:x?)+?)?", "g", S);
t("(?<=y+?)?", "(?<=y+?)?", "g", S);
t("(?<=(?:^|z)?)", "(?<=(?:^|z)?)", "g", S);
t("(?<=(?:z)+?|)?", "(?<=(?:z)+?|)?", "g", S);
t("(?<=\\b(?:.?)+?)", "(?<=\\b(?:.?)+?)", "g", S);
