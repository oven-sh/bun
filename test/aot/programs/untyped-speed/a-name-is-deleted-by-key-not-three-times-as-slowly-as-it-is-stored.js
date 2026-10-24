// A new object gets four names by key and loses one of them by key. The deletion may cost a few times one of the stores, not three times.
const names = ["timeout", "error", "close", "end"].map(name => name + String(Date.now()).slice(99));
const listener = () => 1;
function fill() { const o = Object.create(null); for (let k = 0; k < 4; k++) o[names[k]] = listener; return o; }
function filled(n) { let t = 0; for (let i = 0; i < n; i++) t += fill()[names[3]] === listener ? 1 : 0; return t; }
function filledAndDeleted(n) { let t = 0; for (let i = 0; i < n; i++) { const o = fill(); delete o[names[i & 3]]; t += o[names[3]] === listener ? 1 : 0; } return t; }
function fastestOf(run) { let fastest = Infinity; for (let turn = 0; turn < 5; turn++) { const began = performance.now(); run(300000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const four = fastestOf(filled), withDeletion = fastestOf(filledAndDeleted);
console.log(withDeletion - four < four / 4 * 3 ? "under three times a store" : "over three times a store");
