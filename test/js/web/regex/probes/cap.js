const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const at = (label, src, fl, str, i) => { const re = new RegExp(src, fl); re.lastIndex = i; const m = re.exec(str);
  out((label + " @" + i).padEnd(46) + s(m && { i: m.index, g: [...m] })); };
// index 1 of ".\n": the neg-LB fails to match (good), then \s{0,2} matches "", then (?:\1) must match "" (\1 undefined)
at("full", "(?<!\\p{ASCII_Hex_Digit}*(?=\\b)(?:\\w?.{1,3}(x\\da)??))\\s{0,2}(?:\\1)", "vy", ".\n", 1);
at("no-hexrun", "(?<!(?=\\b)(?:\\w?.{1,3}(x\\da)??))\\s{0,2}(?:\\1)", "vy", ".\n", 1);
at("no-la", "(?<!\\p{ASCII_Hex_Digit}*(?:\\w?.{1,3}(x\\da)??))\\s{0,2}(?:\\1)", "vy", ".\n", 1);
at("just-cap-in-neglb", "(?<!(x\\da)??)(?:\\1)", "vy", ".\n", 1);
at("cap-set-then-ref", "(?<!\\w(x\\da)??)(?:\\1)", "vy", ".\n", 1);
at("what is \\1 after neg-lb?", "(?<!\\p{ASCII_Hex_Digit}*(?=\\b)(?:\\w?.{1,3}(x\\da)??))()", "vy", ".\n", 1);
at("at index 0 (works)", "(?<!\\p{ASCII_Hex_Digit}*(?=\\b)(?:\\w?.{1,3}(x\\da)??))\\s{0,2}(?:\\1)", "vy", ".\n", 0);
