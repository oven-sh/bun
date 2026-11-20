const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const G = "\u{1F600}";
// Make BOTH alternatives able to succeed later, to see where the scan lands after "-".
// alt1 = 😀 (astral), alt2 = -?a. Subject "-Xa": after failing at 0, where next? plant 'a' at various offsets.
const t = (str) => { const m = new RegExp(G + "|-?a", "u").exec(str); out(s(str).padEnd(14) + s(m && [m.index, m[0]])); };
t("-a");        // a at 1: if scan lands at 1, we get [1,"a"]... but -?a from 0 already gives [0,"-a"]
t("-Xa");       // X at 1, a at 2
t("-XXa");
t("-" + G);     // the failing case
t("-X" + G);    // astral at 2
t("-XX" + G);   // astral at 3
t("-XXX" + G);
t("-a" + G);
