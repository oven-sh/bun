const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
out("(?:^)?a  ba  -> " + s(/(?:^)?a/.exec("ba")));
out("(^)*a    ba  -> " + s(/(^)*a/.exec("ba")));
out("\\B(?:^)? xx -> " + s(/\B(?:^)?/.exec("xx")));
