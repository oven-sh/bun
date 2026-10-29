const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);

say("case", ["Straße".toUpperCase(), "ABCİ".toLowerCase(), "ǆ".toUpperCase()]);
say("numbers as text", [
  (1234.5678).toString(),
  (255).toString(16),
  (0.1 + 0.2).toString(),
  String(1e21),
  `${1e-7}`,
  (1234.5678).toString(36),
  Math.round(1234.5678 * 100) / 100,
  (12).valueOf(),
]);
say("numbers from text", [
  Number("1.5e3"),
  parseFloat("2.50x"),
  parseInt("ff", 16),
  Number.parseFloat("1e-7"),
  Number.isInteger(5),
  Number.isSafeInteger(2 ** 53),
]);
say("longer by hand", [
  "000".slice("5".length) + "5",
  "ab" + "xyz".slice(0, 2),
  ["ab", "ab", "ab"].join(""),
  Array(3).fill("x").join(""),
]);
say("search", [
  "abcabc".indexOf("b"),
  "abcabc".indexOf("b", 2),
  "abcabc".includes("ca"),
  "abcabc".startsWith("abc"),
  "abcabc".endsWith("bc"),
  [..."abcabc"].reverse().indexOf("b"),
]);
say("pieces", [
  "a,b,c".split(","),
  " x ".trim(),
  " x ".trimStart(),
  " x ".trimEnd(),
  "abc".slice(1),
  "abc".substring(0, 2),
  "abc".substr(1, 1),
  "abc".at(-1),
  "abc".charAt(1),
  "abc".charCodeAt(1),
  "😀".codePointAt(0),
]);
say("made", [
  String.fromCharCode(65, 0x4e16),
  String.fromCodePoint(0x1f600),
  String.raw`a\n${1}`,
  "a".concat("b", "c"),
  "aXbX".replace("X", "-"),
  "aXbX".replaceAll("X", "-"),
]);
say("order", ["a".localeCompare("b"), ["b", "a", "C"].sort(), "a" < "b"]);
say("surrogates by hand", ["a\ud800".charCodeAt(1) >= 0xd800, [..."a😀"].length]);
say("tags by hand", ["<b>" + "t" + "</b>", `<a name="${"x".replaceAll('"', "&quot;")}">t</a>`]);
say("percent signs by other roads", [
  new URLSearchParams({ q: "a b&世" }).toString(),
  new URL("http://x/a b?q=é").href,
  Buffer.from("a b").toString("hex"),
]);
class Money {
  constructor(public cents: number) {}
  toText(digits: number) {
    const whole = Math.trunc(this.cents / 100);
    return whole + "." + String((this.cents % 100) + 100).slice(1, 1 + digits);
  }
}
say("a class of one's own", new Money(123456).toText(2));
console.log(1234.5678, 1e21, 1e-7, -0, "text", [0.1]);
console.log(lines.join("\n"));
