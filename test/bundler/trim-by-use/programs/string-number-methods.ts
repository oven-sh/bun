const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);
type Old = string & Record<string, (value?: string) => string>;

say("locale case", [
  "Iİi".toLocaleLowerCase("tr"),
  "iı".toLocaleUpperCase("tr"),
  "Straße".toLocaleUpperCase(),
  "ABC".toLocaleLowerCase("en-US"),
]);
say("number formatting", [
  (1234.5678).toFixed(2),
  (0.000001234).toExponential(3),
  (1234.5678).toPrecision(6),
  (1e21).toFixed(2),
  (0).toExponential(),
  (255).toPrecision(1),
]);
say("padding", ["5".padStart(3, "0"), "ab".padEnd(7, "xyz"), "long enough".padStart(3), "世".padEnd(3, "界")]);
say("HTML", [
  ("t" as Old).anchor('a"b'),
  ("t" as Old).big(),
  ("t" as Old).blink(),
  ("t" as Old).bold(),
  ("t" as Old).fixed(),
  ("t" as Old).fontcolor("red"),
  ("t" as Old).fontsize("7"),
  ("t" as Old).italics(),
  ("t" as Old).link("u"),
  ("t" as Old).small(),
  ("t" as Old).strike(),
  ("t" as Old).sub(),
  ("t" as Old).sup(),
]);
say("normalize", [
  "é".normalize().length,
  "é".normalize("NFD").length,
  "ﬁ".normalize("NFKC"),
  "plain".normalize("NFKD"),
]);
say("well formed", ["a\ud800".isWellFormed(), "ab".isWellFormed(), "a\ud800b".toWellFormed()]);
say("repeat", ["ab".repeat(3), "x".repeat(0), "世".repeat(2)]);
say("lastIndexOf", [
  "abcabc".lastIndexOf("b"),
  "abcabc".lastIndexOf("b", 3),
  "abc".lastIndexOf("z"),
  "世a世".lastIndexOf("世"),
]);
say("escape", [escape("a b+é世"), unescape("a%20b%u4E16%E9")]);
say("URI", [
  encodeURI("http://x/a b?q=é&r=1#h"),
  encodeURIComponent("a b&c=世/"),
  decodeURI("%E4%B8%96%20%26"),
  decodeURIComponent("%E4%B8%96%20%26"),
]);
// The compiler folds a call whose operands are constants, and calls code of its own for some methods. Neither enters the function that a program can hold.
const nothing = process.argv.slice(2).join("");
const held = <T>(...functions: T[]): T => functions[nothing.length]!;
say("the functions themselves, as values", [
  held(String.prototype.padStart, String.prototype.padEnd).call("5" + nothing, 3, "0"),
  held(String.prototype.padEnd, String.prototype.padStart).call("5" + nothing, 3, "0"),
  held(String.prototype.repeat, String.prototype.trim as never).call("ab" + nothing, 2),
  held(String.prototype.lastIndexOf, String.prototype.indexOf).call("abcabc" + nothing, "b"),
  held(String.prototype.normalize, String.prototype.trim as never).call("\u00e9" + nothing, "NFD").length,
  held(String.prototype.isWellFormed, String.prototype.trim as never).call("a\ud800" + nothing),
  held(String.prototype.toWellFormed, String.prototype.trim).call("a\ud800b" + nothing),
]);
console.log(lines.join("\n"));
