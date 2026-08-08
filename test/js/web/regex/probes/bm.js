const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}", D = "\u{1F436}";
const t = (label, re, str) => { const m = re.exec(str); out(label.padEnd(34) + s(m && [m.index, m[0]])); };
t("u 😀|zq on -😀", new RegExp(G + "|zq", "u"), "-" + G);           // pure BM: two alternatives, astral first
t("u 😀|zq on ------😀", new RegExp(G + "|zq", "u"), "------" + G);
t("u zq|😀 on -😀", new RegExp("zq|" + G, "u"), "-" + G);
t("u 😀 alone on -😀", new RegExp(G, "u"), "-" + G);
t("u [😀]|zq on -😀", new RegExp("[" + G + "]|zq", "u"), "-" + G);
t("v 😀|zq on -😀", new RegExp(G + "|zq", "v"), "-" + G);
t("no-u 😀|zq on -😀", new RegExp(G + "|zq"), "-" + G);
t("u 🐶|😀 on x😀", new RegExp(D + "|" + G, "u"), "x" + G);
