// The program reads what the last match left in RegExp, so a match of constants against a constant still happens when the program runs.
const out: unknown[] = [];

out.push("a-b".replace(/(-)/, "+"), RegExp.$1, RegExp.lastMatch, RegExp["$`"], RegExp["$'"]);
out.push("xyz".search(/(y)/), RegExp.$1, RegExp.input);
out.push("q".replace(/(z)/, "+"), RegExp.$1);
out.push("a1b22".replace(/(\d+)/g, "<$1>"), RegExp.$1, RegExp.lastParen);
out.push("a1b22".replaceAll(/([a-z])/g, "."), RegExp.$1, RegExp.rightContext);
out.push("plain".replace("l", "L"), RegExp.$1);

console.log(out.map(String).join(" | "));
