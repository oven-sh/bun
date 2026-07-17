const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}";
const t = (label, re, str) => { const m = re.exec(str); out(label.padEnd(30) + s(m && [m.index, m[0]])); };
// vary the number of "-" before the astral; expected index = number of dashes
for (let k = 1; k <= 6; k++) t("😀|-?a  " + "-".repeat(k) + "😀", new RegExp(G + "|-?a", "u"), "-".repeat(k) + G);
// which starts are skipped? use a marker char sequence
t("😀|-?a on _-😀", new RegExp(G + "|-?a", "u"), "_-" + G);
t("😀|-?a on --_😀", new RegExp(G + "|-?a", "u"), "--_" + G);
t("😀|-?a on -_-😀", new RegExp(G + "|-?a", "u"), "-_-" + G);
