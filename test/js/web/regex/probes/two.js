const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}";
const t = (label, re, str) => { const m = re.exec(str); out(label.padEnd(30) + s(m && [m.index, m[0]])); };
// vary the second alternative's shape, keep astral first, subject "-😀"
t("😀|-?a", new RegExp(G + "|-?a", "u"), "-" + G);
t("😀|-a?", new RegExp(G + "|-a?", "u"), "-" + G);
t("😀|-?", new RegExp(G + "|-?", "u"), "-" + G);
t("😀|a?", new RegExp(G + "|a?", "u"), "-" + G);
t("😀|-", new RegExp(G + "|-", "u"), "-" + G);
t("😀|q?a", new RegExp(G + "|q?a", "u"), "-" + G);
t("😀|-{0,1}a", new RegExp(G + "|-{0,1}a", "u"), "-" + G);
t("😀|(?:-)?a", new RegExp(G + "|(?:-)?a", "u"), "-" + G);
t("😀|[-]?a", new RegExp(G + "|[-]?a", "u"), "-" + G);
t("😀|-?a on x😀", new RegExp(G + "|-?a", "u"), "x" + G);
t("😀|-?a on --😀", new RegExp(G + "|-?a", "u"), "--" + G);
