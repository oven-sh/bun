// Two names are read a hundred times off an object out of JSON.parse. Once every object has the same names, once each has a name of its own beside them.
function sum(record) { return record.first + record.second; }
function read(record) { let s = 0; for (let k = 0; k < 100; k++) s = (s + sum(record)) | 0; return s; }
let made = 0;
function ofOneShape(rounds) { let s = 0; for (let r = 0; r < rounds; r++) s = (s + read(JSON.parse(`{"field":1,"first":${r},"second":2}`))) | 0; return s; }
function ofNewShapes(rounds) { let s = 0; for (let r = 0; r < rounds; r++) s = (s + read(JSON.parse(`{"field${made++}":1,"first":${r},"second":2}`))) | 0; return s; }
function timeOf(run) { const began = performance.now(); run(4000); return performance.now() - began; }
// Other work on the machine only adds time. The two take turns, five at least, until the bound holds. Code that is slower never gets there.
let one = Infinity, fresh = Infinity;
for (let turn = 0; turn < 100 && (turn < 5 || fresh >= one * 4); turn++) { one = Math.min(one, timeOf(ofOneShape)); fresh = Math.min(fresh, timeOf(ofNewShapes)); }
// Measured on x86-64 alone.
console.log(ofOneShape(3) === ofNewShapes(3), fresh < one * 4 || process.arch !== "x64" ? "under four times" : "over four times");
