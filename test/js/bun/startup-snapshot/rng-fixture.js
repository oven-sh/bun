const crypto = require("crypto");
Math.random(); crypto.randomBytes(8); crypto.getRandomValues(new Uint8Array(8)); // touch every RNG before the snapshot
process.on("restore", () => {
  console.log("[js]", JSON.stringify({ math: [Math.random(), Math.random()], randomBytes: crypto.randomBytes(8).toString("hex"), webcrypto: Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex"), uuid: crypto.randomUUID(), pid: process.pid, ppid: process.ppid, uptime: process.uptime().toFixed(2), timeOrigin: Math.round(performance.timeOrigin), now: Math.round(performance.now()) }));
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 50);
