// Reads a file while starting up: refused under the default (strict) policy, allowed and reported under BUN_STARTUP_SNAPSHOT_IO=local.
const bytes = require("fs").readFileSync(process.execPath).length;
if (Bun.startupSnapshot.epoch() > 0) { console.log("[js] restored, exe bytes", bytes); process.exit(0); }
process.on("restore", () => { console.log("[js] restored, exe bytes", bytes); process.exit(0); });
