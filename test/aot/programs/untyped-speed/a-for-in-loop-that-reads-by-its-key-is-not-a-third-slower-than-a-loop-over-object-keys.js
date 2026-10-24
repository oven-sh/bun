// The values of an object with sixteen names are added up: in a for-in loop that reads by the key, and in a loop over Object.keys().
const record = {}; for (let i = 0; i < 16; i++) record["n" + i.toString(36)] = i;
function byForIn(turns) { let sum = 0; for (let t = 0; t < turns; t++) for (const key in record) sum = (sum + record[key]) | 0; return sum; }
function byKeys(turns) { let sum = 0; for (let t = 0; t < turns; t++) { const keys = Object.keys(record); for (let i = 0; i < keys.length; i++) sum = (sum + record[keys[i]]) | 0; } return sum; }
function fastestOf(run) { let fastest = Infinity; for (let turn = 0; turn < 7; turn++) { const began = performance.now(); run(200000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const forIn = fastestOf(byForIn), keys = fastestOf(byKeys);
console.log(byForIn(10) === byKeys(10), forIn < keys * 4 / 3 ? "under a third slower" : "over a third slower");
