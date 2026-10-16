// Functions made at run time switch on strings that were cut out of other strings, joined from pieces, read from arrays, or are no strings at all.
const lines = [];
const route = new Function("path", "switch (path) { case '/': return 'root'; case '/a': return 'a'; case '/json': return 'json'; case '/user/me': return 'me'; case '/\\u00e9t\\u00e9': return 'summer'; case '/\\u4e16\\u754c': return 'world'; case '': return 'empty'; case '/a/very/long/path/that/goes/on/and/on': return 'long'; default: return 'none'; }");
const url = "http://localhost:3000/json?x=1", wide = "http://localhost/世界#é", latin = "http://localhost/été?";
const cut = (text, from, to) => text.substring(from, to);
const cases = [
  ["a literal", () => "/json"],
  ["cut out", () => cut(url, 21, 26)],
  ["cut out too short", () => cut(url, 21, 25)],
  ["cut out too long", () => cut(url, 21, 27)],
  ["cut to one character", () => cut(url, 21, 22)],
  ["cut to nothing", () => cut(url, 5, 5)],
  ["cut out of a wide string", () => cut(wide, 16, 19)],
  ["narrow text cut out of a wide string", () => cut("世/json界", 1, 6)],
  ["cut out of a Latin-1 string", () => cut(latin, 16, 20)],
  ["joined", () => "/js" + ["on"][0]],
  ["joined of three", () => "/" + "user" + ["/me"][0]],
  ["joined and cut", () => cut("x/us" + ["er/mexx"][0], 1, 9)],
  ["cut of a cut", () => cut(cut(url, 10, 28), 11, 16)],
  ["sliced", () => url.slice(21, 26)],
  ["long", () => cut("##/a/very/long/path/that/goes/on/and/on##", 2, 39)],
  ["long with one character wrong", () => cut("##/a/very/long/path/that/goes/on/and/oN##", 2, 39)],
  ["a string object", () => new String("/json")],
  ["a number", () => 1],
  ["undefined", () => undefined],
  ["null", () => null],
  ["an object that says so", () => ({ toString: () => "/json" })],
  ["a symbol", () => Symbol("/json")],
];
for (const [name, make] of cases) {
  const seen = new Set();
  for (let turn = 0; turn < 300; turn++) seen.add(route(make()));
  lines.push(name + ": " + [...seen].join(" "));
}
let hits = 0;
for (let turn = 0; turn < 200000; turn++) {
  const path = cut(url, 21, 22 + (turn % 6));
  if (route(path) !== "none") hits++;
  if (turn % 3 === 0 && path.length !== 1 + (turn % 6)) hits += 1000000;
}
lines.push("many: " + hits);
const kept = cut(url, 21, 26);
lines.push("the string afterwards: " + route(kept) + " " + kept + " " + kept.length + " " + (kept === "/json") + " " + JSON.stringify({ [kept]: 1 }) + " " + route(kept));
console.log(lines.join("\n"));
