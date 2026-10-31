const out = typeof print === "function" ? print : console.log;
const A = "\u{10400}", a = "\u{10428}"; // Deseret capital / small
const fmt = m => m === null ? "null" : JSON.stringify([...m]) + "@" + m.index;
const t = (label, re, s) => out(label.padEnd(46) + fmt(re.exec(s)));
t("iu lit-becomes-class (?<=𐐀)x on 𐐨x", new RegExp("(?<=" + A + ")x", "iu"), a + "x");
t("iu same on 𐐀x (exact)", new RegExp("(?<=" + A + ")x", "iu"), A + "x");
t("u explicit class (?<=[𐐀𐐨])x on 𐐨x", new RegExp("(?<=[" + A + a + "])x", "u"), a + "x");
t("iu class one member (?<=[𐐀])x on 𐐨x", new RegExp("(?<=[" + A + "])x", "iu"), a + "x");
t("i-only (ucs2) (?<=𐐀)x on 𐐨x", new RegExp("(?<=" + A + ")x", "i"), a + "x");
t("iu forward control 𐐀x on 𐐨x", new RegExp(A + "x", "iu"), a + "x");
t("iu lookahead control (?=𐐀)𐐨x", new RegExp("(?=" + A + ")" + a + "x", "iu"), a + "x");
t("iu bmp fold control (?<=k)x on Kx", /(?<=k)x/iu, "Kx");
