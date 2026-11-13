const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, str, fl="u") => { try { const m = new RegExp(src, fl).exec(str); out((src + " on " + s(str)).padEnd(40) + s(m && [m.index, m[0]])); } catch (e) { out((src + " on " + s(str)).padEnd(40) + "THREW"); } };
const G = "\u{1F600}", H = "\u{1F601}";
t("(?<=xy[^b]+?)", "q" + G); t("(?<=xy[^b]+?)", "xy" + G + "!"); t("(?<=xy[^b]+?)!", "xy" + G + G + "!");
t("(?<=" + H + "[^b]+?)", "a" + G + "\ude00"); t("(?<=xy[^b]*?)!", "xy" + G + "!"); t("(?<=xy[^b]{1,3}?)!", "xy" + G + G + "!");
t("(?<=[^b]+?xy)!", G + "xy!"); t("(?<=xy[^b]+)!", "xy" + G + G + "!"); t("(?<=xy.+?)!", "xy" + G + "!"); t("(?<=xy\\S+?)!", "xy" + G + G + "!");
t("(?<!xy[^b]+?)!", "qz!"); t("(?<!xy[^b]+?)!", "xy" + G + "!");
