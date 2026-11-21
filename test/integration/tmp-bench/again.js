// Usage: bun again.js <old> <new> <programs that keep a CPU busy> <at once> <seconds> <test>   How often a test of Node's fails.
const [old, now, busy, at, seconds, name] = process.argv.slice(2), cwd = require("path").join(__dirname, "../../..");
const burners = Array.from({ length: +busy }, () => Bun.spawn([old, "-e", "const end = Date.now() + 260000; while (Date.now() < end);"], { stdio: ["ignore", "ignore", "ignore"] }));
const seen = { old: {}, new: {} };
for (let round = 0; round < 4; round++)
  for (const [which, exe] of Object.entries({ old, new: now })) {
    const end = Date.now() + (seconds * 1000) / 4;
    await Promise.all(Array.from({ length: +at }, async () => {
      while (Date.now() < end) {
        const p = Bun.spawn([exe, "run", "--config=bunfig.node-test.toml", `test/js/node/test/parallel/${name}`], { cwd, stdout: "ignore", stderr: "pipe", timeout: 30000, env: { ...process.env, BUN_GARBAGE_COLLECTOR_LEVEL: "1" } });
        const err = await p.stderr.text(), key = `${await p.exited} ${/error: .*/.exec(err)?.[0].slice(0, 60) ?? ""}`.trim();
        seen[which][key] = (seen[which][key] ?? 0) + 1;
      }
    }));
  }
for (const it of burners) it.kill();
for (const [which, it] of Object.entries(seen)) console.log(`cond again ${name}, ${busy} busy, ${at} at once, ${which}: ${JSON.stringify(it)}`);
process.exit(0);
