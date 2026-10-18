// word.toLowerCase() | toUpperCase() where the word is a piece of a text that holds a character outside Latin-1: the answers are plain Bun's, whether the piece itself is ASCII or not.
const texts: string[] = [
  "Plain Words And UPPER lower 123 東京",
  "東京 Café CRÈME straße İstanbul ΣΑΣ ǅ ﬁn",
  "😀 Emoji A \ud83d B \ude00 c",
  "x 　 Y",
];
for (const text of texts) {
  const words = text.split(" ");
  console.log(JSON.stringify(words.map(word => word.toLowerCase())), JSON.stringify(words.map(word => word.toUpperCase())));
  for (let from = 0; from < text.length; from += 3) {
    const piece = text.slice(from, from + 5);
    console.log(JSON.stringify([piece, piece.toLowerCase(), piece.toUpperCase(), piece.toLowerCase() === piece, piece.toUpperCase() === piece]));
  }
  console.log(JSON.stringify([text.toLowerCase(), text.toUpperCase(), (text + "|" + text).toLowerCase(), text.slice(0, 0).toUpperCase()]));
}
const long = ("Word ".repeat(40) + "東").slice(0, 190);
console.log(long.toLowerCase().length, long.toUpperCase().slice(0, 12), long.toLowerCase().slice(-7));
let total = 0;
for (let round = 0; round < 5000; round++) {
  const words = ("Round " + round + " Of MANY 東京").split(" ");
  for (const word of words) total += word.toLowerCase().length + (word.toLowerCase() === word ? 1 : 0);
}
console.log(total);
