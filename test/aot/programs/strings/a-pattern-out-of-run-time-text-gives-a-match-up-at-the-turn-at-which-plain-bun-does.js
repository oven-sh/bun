// Plain Bun gives a match up, and answers that there is none, at the hundred millionth turn that the groups of a pattern begin in one match. A pattern made at run time does so at the same turn: not one earlier, which would
// lose a match that plain Bun finds, and not much later, which would go on for hours where plain Bun ends.
const nothing = String(Date.now()).slice(99);
// The turns double with each character.
for (const [text, flags] of [["(?:a|a)*c|a+", ""], ["(?<=^|b)(?:a|a)*c|a+", ""]]) {
  const match = new RegExp(text + nothing, flags).exec("a".repeat(27));
  console.log(text, 27, match === null ? "null" : match[0].length);
}
// The turns grow with the square of the number of words: every `k` is a place to start at, and from each the inner group takes a turn for every word behind it.
const words = new RegExp("(?<!q)(?:\\n|\\bk\\s+(?:\\w+=\\S*\\s+)*)end" + nothing);
for (const count of [14140, 14141]) console.log("words", count, words.test("k" + " A=k".repeat(count) + "\nno\nend"));
