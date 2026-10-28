// An alternation of words with a class of invisible code points between every two letters, out of a piece that the build cannot know, is used three times to replace in a text of 40,000 characters.
// Few matches, a long text, a long pattern: what a pattern's compilation spends on analyses comes back within one match here. Beside it forty short patterns are made and eight of them matched once.
// The output is that of plain Bun.
// COUNTER: RegExpsCompiledToBytecode = 9
const given: string = typeof process === "object" ? process.argv.slice(2).join("") : String(Date.now()).slice(0, 0);
const between = "[\\u200b\\u200c\\u200d\\u2060\\ufeff\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e]*";
const words: string[] = [];
for (let i = 0; i < 40; i++) words.push("word" + i.toString(36) + "secret" + (i * 7919).toString(36) + given);
const giant = new RegExp("(?:" + words.map(word => [...word].join(between)).join("|") + ")", "gi");
let text = "";
for (let i = 0; i < 400; i++) text += "line " + i + " of ordinary prose with words, some secrets such as w​ord" + (i % 40).toString(36) + "secret" + ((i % 40) * 7919).toString(36) + " and a table | a | b |\n";
let total = 0;
for (let i = 0; i < 3; i++) total += text.replace(giant, "[redacted]").length;
const short: RegExp[] = [];
for (let i = 0; i < 40; i++) short.push(new RegExp("^(?:k" + given + "x" + i + "|[a-z]+\\d{" + (i + 1) + "})\\s*$", i & 1 ? "i" : ""));
for (let i = 0; i < 40; i += 5) total += short[i].test("abc" + "1".repeat(i + 1)) ? 1 : 0;
console.log(giant.source.length, text.length, total, text.replace(giant, "[redacted]").slice(0, 90));
