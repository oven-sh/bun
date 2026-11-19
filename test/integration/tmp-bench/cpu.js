// For each variant: the rate, and the CPU cycles of all processes for each operation, as factors of old.
const [old, now, only, variants] = process.argv.slice(2), file = import.meta.dir + "/iobench.js";
const cases = JSON.parse(Bun.spawnSync([old, file, "--list"]).stdout.toString()).filter(([n]) => only.split(",").some(o => (n + "$").includes(o)));
const columns = [[old, ""], ...variants.split(";").map(v => [now, v])];
console.log("cpuop columns:", columns.slice(1).map(([, v]) => v || "as is").join(" | "));
for (const [name, higher] of cases) {
  const seen = columns.map(() => []);
  for (let round = 0; round < 3; round++)
    columns.forEach(([exe, tune], i) => {
      const [value, cycles, ms] = Bun.spawnSync([exe, file, "--case", name], { env: { ...process.env, CYCLES: "1", NO_COLOR: "1", BUN_TMP_TUNE: tune }, timeout: 30000 }).stdout.toString().trim().split(" ").map(Number);
      seen[i].push({ value, perOp: cycles / (value * ms), perMs: cycles / ms });
    });
  const median = (l, key) => l.map(it => it[key]).sort((x, y) => x - y)[1], [a, ...rest] = seen;
  console.log("cpuop", name.padEnd(36).slice(0, 36), `old ${median(a, "perMs").toFixed(1)} Mcyc/ms |`, rest.map(b => (higher ? `${(median(b, "value") / median(a, "value")).toFixed(2)}/${(median(b, "perOp") / median(a, "perOp")).toFixed(2)}` : (median(a, "value") / median(b, "value")).toFixed(2))).join(" | "));
}
