const [old, now] = process.argv.slice(2);
for (let seed = 1; seed <= 4; seed++)
  for (const exe of [old, now])
    Bun.spawnSync([exe, import.meta.dir + "/stress.js", "--only", "terminal,cluster", "--seconds", "10", "--seed", String(seed)], { stdio: ["ignore", "inherit", "inherit"] });
