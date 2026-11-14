import fs from "node:fs";
const dir = process.argv[2];
console.log(fs.readFileSync(dir + "/graph.txt", "utf8"));
const r = JSON.parse(fs.readFileSync(dir + "/results.json", "utf8"));
const names = process.argv[3] ? process.argv[3].split(",") : Object.keys(r);
const fine = process.argv[4] === "fine";
const cols = names.map(n =>
  (fine ? r[n].trace : r[n].trace.filter(s => s !== "|")).concat(
    r[n].unhandled.length ? ["UNH:" + r[n].unhandled.join()] : [],
    r[n].buildFail ? [r[n].buildFail] : [],
    r[n].err ? [r[n].err.slice(0, 300)] : [],
  ),
);
const w = 34;
console.log(names.map(n => n.padEnd(w)).join(""));
for (let i = 0; i < Math.max(...cols.map(c => c.length)); i++) {
  const row = cols.map(c => String(c[i] ?? ""));
  const mark = row.some(x => x !== row[0]) ? " <<" : "";
  console.log(row.map(x => x.slice(0, w - 2).padEnd(w)).join("") + mark);
}
