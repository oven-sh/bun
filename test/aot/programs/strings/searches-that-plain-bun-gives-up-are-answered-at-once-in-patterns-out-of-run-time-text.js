// A pattern made at run time whose search doubles with every character of the subject: plain Bun gives the match up at the hundred millionth turn of a group, after seconds.
// The compiled program gives up at the same length of the subject, and at once: it does not make the same search from the same place twice. That holds where the pattern refers to a group,
// looks behind with groups and runs, has characters beyond the BMP, and where the subject has them.
const nothing = String(Date.now()).slice(99);
const face = "\u{1f600}";
const rows = [
  ["a reference to a group in front of the turns", "(a)(?:\\1{2}|aa)*c|a+", "", count => "a".repeat(count)],
  ["a reference to the group that takes the turns", "(a|a)*\\1c|a+", "", count => "a".repeat(count)],
  ["a reference that is taken as seldom as may be", "(a)(?:\\1*?a|a)*c|a+", "", count => "a".repeat(count)],
  ["references to two groups", "(a)(b?)(?:\\1\\2|a)*c|a+", "", count => "a".repeat(count)],
  ["a reference that ignores case", "(a)(?:\\1|A)*c|a+", "i", count => "a".repeat(count)],
  ["a text between quotes", "(['\"])(?:(?!\\1).|\\\\.|a)*\\1c|.+", "", count => "'" + "a".repeat(count)],
  ["a character beyond the BMP", "(?:" + face + "|" + face + ")*c|" + face + "+", "u", count => face.repeat(count)],
  ["a class with a character beyond the BMP", "(?:[" + face + "a]|" + face + ")*c|.+", "u", count => face.repeat(count)],
  ["a dot behind a pair", "(?:.|a)*c|.+", "u", count => face + "a".repeat(count)],
  ["a dot on pairs", "(?:.|.)*c|.+", "u", count => face.repeat(count)],
  ["a negated class in front of a pair", "(?:[^x]|a)*c|.+", "u", count => "a".repeat(count) + face],
  ["properties on pairs", "(?:\\P{L}|\\p{Emoji})*c|.+", "u", count => face.repeat(count)],
  ["half a pair", "(?:\\ud83d|\\ud83d)*c|.+", "u", count => "\ud83d".repeat(count)],
  ["a difference of classes in front of a pair", "(?:[\\p{L}--[b]]|a)*c|.+", "v", count => "a".repeat(count) + face],
  ["a lookbehind with a group", "a+(?<=c(?:a|a)*)|a+", "", count => "a".repeat(count)],
  ["a lookbehind with a run behind turns", "(?:a|a)*(?<=b+)c|a+", "", count => "a".repeat(count)],
  ["a lookbehind that must fail, with a group", "(?:a|a)*(?<!(?:a|b)+)c|a+", "", count => "a".repeat(count)],
];
for (const [name, source, flags, subject] of rows) {
  const answers = [];
  let slowest = 0;
  for (let count = 20; count <= 32; count++) {
    const began = performance.now();
    const match = new RegExp(source + nothing, flags).exec(subject(count) + nothing);
    slowest = Math.max(slowest, performance.now() - began);
    answers.push(match === null ? "-" : match[0].length);
  }
  if (process.argv[2] === "show") console.log(Math.round(slowest) + " ms");
  console.log(name + ":", answers.join(" "), slowest < 1000 ? "each within a second" : "one took " + Math.round(slowest) + " ms");
}
