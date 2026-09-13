const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
const at = (label, re, str, i) => { re.lastIndex = i; const m = re.exec(str); out((label + " @" + i).padEnd(32) + s(m && m.index)); };
// isolate position 3 in "prefix" (between 'e' and 'f'): \b false at 3, true at 0
for (const i of [0,1,2,3,4,5,6]) at("(?<=\\b(?:.?)+?)", new RegExp("(?<=\\b(?:.?)+?)", "y"), "prefix", i);
out("---");
for (const i of [3,4]) { at("(?<=\\b(?:.)+?)", new RegExp("(?<=\\b(?:.)+?)", "y"), "prefix", i); at("(?<=\\b.+?)", new RegExp("(?<=\\b.+?)", "y"), "prefix", i); at("(?<=\\b(?:.?)+)", new RegExp("(?<=\\b(?:.?)+)", "y"), "prefix", i); at("(?<=\\b(?:.??)+?)", new RegExp("(?<=\\b(?:.??)+?)", "y"), "prefix", i); at("(?<=\\ba*b?.+?)", new RegExp("(?<=\\ba*b?.+?)", "y"), "prefix", i); }
