// `a + b + c` of three strings, each of them empty or not, flat or a rope, of one-byte or two-byte characters, in code that runs once and in code that runs often.
// What comes out is read in every way that needs its text: its length, a character, a pattern, a key of an object, a comparison, JSON.
function join(a, b, c) { return a + b + c; }
function joinTexts(a, b, c) { return `${a}${b}${c}`; }
function rope(text) { return text.slice(0, 1) + text.slice(1) + ""; }
const kinds = [
  () => "",
  () => String(""),
  () => "path",
  () => "/a/longer/path/with/many/parts/that/does/not/fit/a/small/string",
  () => "zwölf",
  () => "日本語",
  () => rope("made-of-two"),
  () => rope("日本") + rope("語x"),
  () => "x".repeat(3),
  () => JSON.parse('"parsed"'),
  () => JSON.parse('""'),
  () => [].join(","),
];
const pattern = /^\/|th$|語/;
const lines = [];
let checked = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < kinds.length; i++) {
    for (let j = 0; j < kinds.length; j++) {
      for (let k = 0; k < kinds.length; k++) {
        const a = kinds[i](), b = kinds[j](), c = kinds[k]();
        const joined = round % 2 ? join(a, b, c) : joinTexts(a, b, c);
        const expected = [a, b, c].join("");
        const holder = { [joined]: 1 };
        if (joined.length !== a.length + b.length + c.length || joined !== expected || !(expected in holder) || pattern.test(joined) !== pattern.test(expected)
          || joined.at(-1) !== expected.at(-1) || JSON.stringify(joined) !== JSON.stringify(expected) || typeof joined !== "string")
          lines.push(`differs: ${i} ${j} ${k} in round ${round}: ${JSON.stringify(joined)}`);
        checked++;
      }
    }
  }
  if (round % 16 === 15) Bun.gc(true);
}
const once = kinds[2]() + kinds[0]() + kinds[1]();
console.log(checked, lines.length, lines.slice(0, 5).join("\n"), once, once.length, pattern.test(once), join("", "", "") === "", join("", "", "").length);
