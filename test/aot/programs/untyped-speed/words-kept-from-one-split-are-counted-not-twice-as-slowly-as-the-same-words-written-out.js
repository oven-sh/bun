// A text of 4,096 words, four different ones, is split once and the pieces are kept. They are counted by key again and again. The same loop runs over a list that holds the four words as written.
const written = ["alpha", "beta", "gamma", "delta"];
const list = []; for (let i = 0; i < 4096; i++) list.push(written[(i * 7 + (i >> 3)) & 3]);
const pieces = list.join(" ").split(" ");
function count(words, turns) { const counts = {}; for (let t = 0; t < turns; t++) { const word = words[t & 4095]; counts[word] = (counts[word] ?? 0) + 1; } return counts; }
function fastestOf(words) { let fastest = Infinity; for (let turn = 0; turn < 7; turn++) { const began = performance.now(); count(words, 2000000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const byWritten = fastestOf(list), byPieces = fastestOf(pieces);
console.log(JSON.stringify(count(list, 4096)) === JSON.stringify(count(pieces, 4096)), byPieces < byWritten * 2 ? "under twice" : "over twice");
