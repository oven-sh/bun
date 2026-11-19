// Usage: bun tune.js <old> <new> <case substring>,...   Medians of 5, as a ratio to old (more is better).
const [old, now, only] = process.argv.slice(2);
const file = import.meta.dir + "/iobench.js";
const names = JSON.parse(Bun.spawnSync([old, file, "--list"]).stdout.toString()).filter(([n]) => only.split(",").some(o => (n + "$").includes(o)));
const columns = [[old, ""], [old, "old+new peer", now], [now, "new+old peer", old], [now, ""]];
console.log("".padEnd(44), "old".padStart(9), ...columns.slice(1).map(([, v]) => (v || "as is").padStart(Math.max(7, v.length))));
for (const [name, higher] of names) {
  const seen = columns.map(() => []);
  for (let round = 0; round < 5; round++)
    columns.forEach(([exe, , peer], i) => seen[i].push(parseFloat(Bun.spawnSync([exe, file, "--case", name], { env: { ...process.env, ROLE_EXE: peer ?? exe }, timeout: 30000 }).stdout.toString())));
  const [base, ...rest] = seen.map(l => l.sort((a, b) => a - b)[2]);
  console.log("tune " + name.padEnd(39).slice(0, 39), base.toFixed(0).padStart(9), ...rest.map((v, i) => (higher ? v / base : base / v).toFixed(2).padStart(Math.max(7, columns[i + 1][1].length))));
}
