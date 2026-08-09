// Everything derived from the launching process must reflect the process that RESTORED the image, not the one that built it.
const os = require("os");
function ctx() {
  return { argv: process.argv.slice(2), bunArgv: Bun.argv.slice(2), marker: process.env.LAUNCH_MARKER, home: os.homedir(), cwd: process.cwd(), execArgv: process.execArgv };
}
console.log("[js] build " + JSON.stringify(ctx()));
process.on("restore", () => { console.log("[js] restored " + JSON.stringify(ctx())); process.exit(0); });
setTimeout(() => Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { timers: "cancel" }), 50);
