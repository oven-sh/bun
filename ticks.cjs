// Counts process.nextTick calls per 'data' chunk for a writer that never pauses.
const { spawn } = require("node:child_process");
const SIZE = +(process.env.SIZE || 64 * 1024 * 1024);
let ticks = 0;
const nt = process.nextTick;
process.nextTick = function () { ticks++; return nt.apply(this, arguments); };
const c = spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "inherit"] });
let chunks = 0, bytes = 0;
const t0 = ticks;
c.stdout.on("data", d => { chunks++; bytes += d.length; });
c.stdout.on("end", () => console.log(JSON.stringify({ bytes, chunks, ticksPerChunk: +((ticks - t0) / chunks).toFixed(3), ownEmit: Object.hasOwn(c.stdout, "emit") })));
