const [old, now] = process.argv.slice(2);
for (const peer of ["drops", "silent"])
  for (const exe of [old, now]) {
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push(Bun.spawnSync([exe, import.meta.dir + "/redis-gc.js", peer]).stdout.toString().trim());
    console.log("redis-gc", peer, exe === old ? "old" : "new", JSON.stringify(seen));
  }
if (process.arch === "x64")
  for (const peer of ["drops", "silent"]) Bun.spawnSync([process.env.PROFILE_EXE, import.meta.dir + "/redis-gc.js", peer, "stack"], { stdio: ["ignore", "inherit", "inherit"] });
