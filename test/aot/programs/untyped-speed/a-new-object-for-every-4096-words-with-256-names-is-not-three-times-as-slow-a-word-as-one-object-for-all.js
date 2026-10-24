// Words are counted by key, 256 different ones. Once into one object for the whole run, once into a new object for every 4,096 words.
const names = []; for (let i = 0; i < 256; i++) names.push("w" + i.toString(36));
const words = []; for (let i = 0; i < 4096; i++) words.push(names[(i * 7 + (i >> 3)) & 255]);
function intoOne(rounds) { const counts = {}; for (let r = 0; r < rounds; r++) for (let i = 0; i < 4096; i++) { const word = words[i]; counts[word] = (counts[word] ?? 0) + 1; } return counts[words[0]]; }
function intoNew(rounds) { let sum = 0; for (let r = 0; r < rounds; r++) { const counts = {}; for (let i = 0; i < 4096; i++) { const word = words[i]; counts[word] = (counts[word] ?? 0) + 1; } sum += counts[words[0]]; } return sum; }
function fastestOf(run) { let fastest = Infinity; for (let turn = 0; turn < 5; turn++) { const began = performance.now(); run(200); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const one = fastestOf(intoOne), fresh = fastestOf(intoNew);
console.log(intoOne(3) === intoNew(3), fresh < one * 3 ? "under three times" : "over three times");
