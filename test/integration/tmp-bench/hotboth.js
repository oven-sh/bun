for (const exe of process.argv.slice(2, 4)) console.log("cond hot", Bun.spawnSync([exe, import.meta.dir + "/hotstale.js", process.argv[4]], { timeout: 120000 }).stdout.toString());
