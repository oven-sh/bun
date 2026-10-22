// A helper stores under computed keys into whatever it is handed. What it is handed here are objects of the program, some of them out of places that nobody follows.
function extend(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
const parsed = JSON.parse('{"kind":"parsed"}');
const made = extend(parsed, { shout() { return this.kind + "!"; }, size: 3 });
const other = extend({}, { shout() { return "other"; }, trim: "not the method" });
console.log(made.shout(), made.size, other.shout(), other.trim);

const text = "  text  ";
console.log(text.trim(), text.shout, text.size, (5).shout, true.size, 10n.shout, Symbol.iterator.size);
console.log("kind" in String.prototype, Object.keys(String.prototype).length, Object.keys(Number.prototype).length);
for (const value of [text, 5, true, 10n, Symbol.iterator, made]) console.log(typeof value, typeof value.shout, typeof value["si" + "ze"]);
