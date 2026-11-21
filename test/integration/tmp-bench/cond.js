// Usage: bun cond.js <old> <new> <all|busy|affinity mask> <case substring,...> <variant;...> [rounds]
// For each variant of the new build: the rate, and the CPU cycles of all processes for each operation, as factors of old.
const [old, now, condition, only, variants, rounds = 3] = process.argv.slice(2), file = import.meta.dir + "/iobench.js";
const k32 = require("bun:ffi").dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } }).symbols;
const cases = JSON.parse(Bun.spawnSync([old, file, "--list"]).stdout.toString()).filter(([n]) => only.split(",").some(o => (n + "$").includes(o)));
const columns = [[old, ""], ...variants.split(";").map(v => [v === "before" ? process.env.BEFORE_BUN : now, v])], isBusy = condition === "busy";
const env = { ...process.env, CYCLES: "1", NO_COLOR: "1", SHORT: process.env.SHORT ?? (isBusy ? "0.8" : "0.4"), SMALL: process.env.SMALL ?? (isBusy ? "0.125" : "0.5") };
const burners = isBusy ? require("os").cpus().map(() => Bun.spawn([old, "-e", "const end = Date.now() + 900000; while (Date.now() < end);"], { stdio: ["ignore", "ignore", "ignore"] })) : [];
if (/^\d/.test(condition) && !k32.SetProcessAffinityMask(-1n, BigInt(condition))) console.log("# the affinity was refused");
console.log(`cond ${condition}, ${require("os").cpus().length} cpus:`.padEnd(51), columns.slice(1).map(([, v]) => (v || "as is").padEnd(10)).join(" "));
for (const [name, higher] of cases) {
  const seen = columns.map(() => []);
  for (let round = 0; round < rounds; round++)
    for (let turn = 0; turn < columns.length; turn++) {
      const i = (turn + round) % columns.length, { BUN_MI, ...rest } = Object.fromEntries(columns[i][1].split(",").filter(it => /^[A-Z]/.test(it)).map(it => it.split("=")));
      const tune = columns[i][1].split(",").filter(it => /^\d/.test(it)).join();
      const [value, cycles, ms] = Bun.spawnSync([columns[i][0], file, "--case", name], { env: { ...env, ...rest, BUN_TMP_TUNE: tune }, timeout: 40000, stdin: "ignore" }).stdout.toString().trim().split(" ").map(Number);
      seen[i].push({ value, perOp: cycles / (value * ms) });
    }
  const sorted = (l, key) => l.map(it => it[key]).sort((x, y) => x - y), median = (l, key) => sorted(l, key)[rounds >> 1], [a, ...rest] = seen;
  const spread = Math.max(...seen.map(l => (sorted(l, "value").at(-1) - sorted(l, "value")[0]) / median(l, "value")));
  const cell = (b, i) => (higher ? `${(median(b, "value") / median(a, "value")).toFixed(2)}/${(median(b, "perOp") / median(a, "perOp")).toFixed(2)}` : (median(a, "value") / median(b, "value")).toFixed(2)).padEnd(Math.max(10, columns[i + 1][1].length));
  console.log("cond", name.padEnd(36).slice(0, 36), median(a, "value").toFixed(0).padStart(8), " ", rest.map(cell).join(" "), `spread ${(spread * 100).toFixed(0)} %`);
}
for (const it of burners) it.kill();
