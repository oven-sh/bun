function quote(text: string): string {
  return JSON.stringify(text);
}
function quoteOrNothing(text: string | undefined): string | undefined {
  return JSON.stringify(text);
}
function quoteOrNull(text: string | null): string {
  return JSON.stringify(text);
}
function quoteIfAny(text?: string | null): string | undefined {
  return JSON.stringify(text);
}
function quoteOneOf(text: "left" | "right" | "\u4e2d"): string {
  return JSON.stringify(text);
}
function hide(value: unknown): any {
  return value;
}
const long = "0123456789abcdef".repeat(5000);
const texts: string[] = [
  "",
  "a",
  "plain text",
  'with "quotes" and \\ backslashes',
  "\n\r\t\b\f\v\0\x1f\x7f",
  "\u00e9\u00ff",
  "\u0416\u4e2d",
  "\ud83d\ude00",
  "\ud800",
  "\udc00 alone",
  "pair \ud83d\ude00 and half \ud83d",
  "\u2028\u2029",
  "<script>",
  long,
  long + "\u4e2d",
  long + '"',
];
for (const text of texts) {
  const quoted = quote(text);
  console.log(quoted.length, quoted.length < 80 ? quoted : quoted.slice(0, 20) + ".." + quoted.slice(-20), JSON.parse(quoted) === text);
}
let rope = "";
for (let i = 0; i < 40; i++) rope += "part " + i + (i % 7 ? ", " : ' "q" ');
console.log(quote(rope));
console.log(quote(rope.slice(5, 60)), quote(rope.substring(1, 2)), quote(long.slice(3, 9)));
console.log(quote(rope + "\u4e2d" + rope).length);
console.log(quote(String(12.5)), quote(`${1}${"two"}`), quote(["a", "b"].join("\n")));
console.log(quoteOrNothing("here"), quoteOrNothing(undefined), quoteOneOf("left"), quoteOneOf("\u4e2d"));
console.log(quoteOrNull("here"), quoteOrNull(null), quoteOrNull(""), quoteIfAny(), quoteIfAny(null), quoteIfAny(undefined), quoteIfAny("\u4e2d"), typeof quoteIfAny());
console.log(JSON.stringify(quote(quote("twice"))));
console.log(JSON.stringify(hide(new String("an object"))), JSON.stringify(hide("hidden")), JSON.stringify({ held: "a member" }));
