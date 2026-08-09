const big = Array.from({ length: 200_000 }, (_, i) => ({ i, s: "x" + i }));
let n = 0;
function startTicking() { setInterval(() => { n++; console.log("[js] tick", n, "len", big.length, "big[123].s", big[123].s); if (n >= 3) process.exit(0); }, 200); }
process.on("restore", () => { console.log("[js] restored! epoch", Bun.unsafe.snapshotState().epoch); startTicking(); });
if (process.env.BUN_IMAGE_OUT) setTimeout(() => Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { timers: "cancel" }), 50);
else startTicking();
