const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
out("(?:^a){0}b  xb -> " + s(/(?:^a){0}b/.exec("xb"))); out("(?=^a){0}b  xb -> " + s(/(?=^a){0}b/.exec("xb")));
out("(a)|(?:^b){0}c xc -> " + s(/(a)|(?:^b){0}c/.exec("xc"))); out("(?:^a){0}(?:^b)?c xc -> " + s(/(?:^a){0}(?:^b)?c/.exec("xc")));
out("(?:^a)b ab (required, control) -> " + s(/(?:^a)b/.exec("ab"))); out("(?:^a)b xab (control) -> " + s(/(?:^a)b/.exec("xab")));
