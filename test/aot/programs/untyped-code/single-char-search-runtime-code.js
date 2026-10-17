// Functions made at run time look for one character in strings of every kind, from every place.
const lines = [];
const find = new Function("text", "what", "from", "return text.indexOf(what, from);");
const findFromStart = new Function("text", "what", "return text.indexOf(what);");
const url = "http://localhost:3000/user/me?x=1&y=2#end", wide = "世界/été/世", latin = "café/été";
const texts = [["narrow", url], ["wide", wide], ["Latin-1", latin], ["empty", ""], ["one", "/"], ["joined", "http://" + ["local"][0] + "host/a"], ["cut", url.substring(7, 30)], ["long", "x".repeat(5000) + "/" + "y".repeat(5000) + "/"]];
const needles = ["/", "?", "#", "h", "d", "z", "é", "世", "界", "Ā", "\0", "", "//", "me", 1, null, undefined, { toString: () => "/" }];
const places = [undefined, 0, 1, 7, 11, 21, 40, 41, 42, 1000000, -1, -1000000, 1.9, -0.5, NaN, Infinity, -Infinity, "11", null, true, { valueOf: () => 11 }];
for (const [name, text] of texts) {
  const rows = [];
  for (const needle of needles) rows.push(places.map(place => find(text, needle, place)).join(","));
  lines.push(name + ": " + rows.join(" | "));
  lines.push(name + " from the start: " + needles.map(needle => findFromStart(text, needle)).join(","));
}
const onOthers = new Function("receiver", "what", "return String.prototype.indexOf.call(receiver, what);");
lines.push("other receivers: " + [[12345, "3"], [true, "u"], [[1, 2], ","], [{}, "o"], [new String("a/b"), "/"]].map(([receiver, what]) => onOthers(receiver, what)).join(","));
for (const receiver of [null, undefined]) { try { onOthers(receiver, "/"); lines.push("no error"); } catch (error) { lines.push(error.name); } }
let sum = 0;
for (let turn = 0; turn < 200000; turn++) { const s = find(url, "/", 11); sum += s + find(url, "?", s + 1) + find(wide, "/", turn & 7); }
lines.push("many: " + sum);
console.log(lines.join("\n"));
