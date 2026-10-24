// counts[word] = (counts[word] ?? 0) + 1 over a list of words with four different words in it, and over one with sixty-four.
function listOf(different) { const names = []; for (let i = 0; i < different; i++) names.push("w" + i.toString(36)); const list = []; for (let i = 0; i < 4096; i++) list.push(names[(i * 7 + (i >> 3)) % different]); return list; }
const few = listOf(4), many = listOf(64);
function count(words, turns) { const counts = {}; for (let t = 0; t < turns; t++) { const word = words[t & 4095]; counts[word] = (counts[word] ?? 0) + 1; } return counts; }
function fastestOf(words) { let fastest = Infinity; for (let turn = 0; turn < 7; turn++) { const began = performance.now(); count(words, 2000000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const withFew = fastestOf(few), withMany = fastestOf(many);
console.log(Object.keys(count(few, 4096)).length, Object.keys(count(many, 4096)).length, withFew < withMany * 5 / 4 ? "not slower" : "slower");
