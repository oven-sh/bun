const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}";
const t = (label, re, str) => { const m = re.exec(str); out(label.padEnd(28) + s(m && [m.index, m[0]])); };
t("😀|-a   -😀", new RegExp(G + "|-a", "u"), "-" + G);   // required consume then fail
t("😀|--a  --😀", new RegExp(G + "|--a", "u"), "--" + G);
t("😀|-?a  -😀", new RegExp(G + "|-?a", "u"), "-" + G);  // optional (known bad)
t("😀|.a   -😀", new RegExp(G + "|.a", "u"), "-" + G);   // dot consume then fail
t("😀|[-x]a -😀", new RegExp(G + "|[-x]a", "u"), "-" + G);// class consume then fail
t("😀|-+a  -😀", new RegExp(G + "|-+a", "u"), "-" + G);  // greedy required
t("😀|-*a  -😀", new RegExp(G + "|-*a", "u"), "-" + G);  // greedy optional
