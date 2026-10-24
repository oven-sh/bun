// Eight names come out of a header line by split() and are kept. Every row is read under each of them, again and again. The same loop runs with the eight names written out.
const written = ["id", "name", "email", "city", "role", "note", "lang", "tag"];
const fromHeader = written.join(",").split(",");
const rows = []; for (let i = 0; i < 64; i++) rows.push({ id: i, name: i + 1, email: i + 2, city: i + 3, role: i + 4, note: i + 5, lang: i + 6, tag: i + 7 });
function sumOf(names, turns) { let sum = 0; for (let t = 0; t < turns; t++) { const row = rows[t & 63]; for (let c = 0; c < 8; c++) sum = (sum + row[names[c]]) | 0; } return sum; }
function fastestOf(names) { let fastest = Infinity; for (let turn = 0; turn < 7; turn++) { const began = performance.now(); sumOf(names, 400000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const byWritten = fastestOf(written), byHeader = fastestOf(fromHeader);
console.log(sumOf(written, 1000) === sumOf(fromHeader, 1000), byHeader < byWritten * 4 / 3 ? "under a third slower" : "over a third slower");
