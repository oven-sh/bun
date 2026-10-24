// As its neighbor without a lookbehind, with what not every matcher of patterns made at run time takes: a lookbehind, modifiers, a set of the flag v, a property, pairs of surrogates in unicode mode.
const nothing = String(Date.now()).slice(99);
for (const [text, flags, unit, length] of [
  ["(?<=^|b)(?:a|a)*c|a+", "", "a", 26],
  ["(?i:a|a)*c|a+", "", "a", 26],
  ["(?:[a--b]|a)*c|a+", "v", "a", 26],
  ["(?:\\p{L}|a)*\\d|a+", "u", "a", 26],
  ["(?:\\u{1F600}|\\u{1F600})*c|(?:\\u{1F600})+", "u", "\u{1F600}", 26],
]) {
  const match = new RegExp(text + nothing, flags).exec(unit.repeat(length));
  console.log(text, flags, length, match === null ? "null" : match[0].length);
}
