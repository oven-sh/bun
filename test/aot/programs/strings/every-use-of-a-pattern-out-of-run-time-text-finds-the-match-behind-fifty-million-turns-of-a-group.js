// exec, test, match, matchAll, replace, replaceAll, search and split of a pattern whose first alternative fails only behind more than fifty million turns of its group, on subjects of 8-bit and of 16-bit characters.
const nothing = String(Date.now()).slice(99);
const text = "(?:a|a)*c|a+" + nothing;
const narrow = "a".repeat(26) + nothing;
const wide = "a".repeat(25) + "一" + nothing;
console.log("exec", new RegExp(text).exec(narrow)?.[0].length);
console.log("test", new RegExp(text).test(wide));
console.log("match", narrow.match(new RegExp(text))?.[0].length);
console.log("matchAll", [...wide.matchAll(new RegExp(text, "g"))].map(match => match[0].length).join());
console.log("replace", narrow.replace(new RegExp(text), "<$&>").length);
console.log("replaceAll", wide.replaceAll(new RegExp(text, "g"), "-"));
console.log("search", narrow.search(new RegExp(text)));
console.log("split", wide.split(new RegExp(text)).length);
console.log("sticky", new RegExp(text, "y").exec(narrow)?.[0].length);
