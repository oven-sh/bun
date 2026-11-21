// Usage: bun linger.js <old> <new> <runs> [one]   With "one", the two ends of a pipe never both call destroy().
const [old, now, runs, one = ""] = process.argv.slice(2), seen = { old: {}, new: {} };
for (let i = 1; i <= runs; i++) for (const [name, exe] of [["old", old], ["new", now]]) { const verdict = Bun.spawnSync([exe, import.meta.dir + "/stress.js", "--only", "named-pipe", "--seconds", "3", "--seed", String(i)], { env: { ...process.env, STRESS_TLS: "{}", STRESS_ONE_RUDE: one } }).stdout.toString().match(/^named-pipe +(\w+)/m)?.[1]; seen[name][verdict] = (seen[name][verdict] ?? 0) + 1; }
console.log("cond linger", one, JSON.stringify(seen));
