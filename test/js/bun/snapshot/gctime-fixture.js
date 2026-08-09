const keep = []; for (let i = 0; i < 300000; i++) keep.push({ i, s: "str" + i, a: [i], f() { return i; } });   // ~sizable snapshot heap
function fullGcMs() { const t = performance.now(); Bun.gc(true); return Math.round(performance.now() - t); }
console.log("[js] build: full gc", fullGcMs(), "ms; heap", (process.memoryUsage().heapUsed / 1048576) | 0, "MB");
process.on("restore", async () => {
  console.log("[js] restored: full gc #1", fullGcMs(), "ms");
  const fresh = []; for (let i = 0; i < 200000; i++) fresh.push({ i, k: keep[i % keep.length] });
  console.log("[js] restored: after alloc, full gc #2", fullGcMs(), "ms; #3", fullGcMs(), "ms; heap", (process.memoryUsage().heapUsed / 1048576) | 0, "MB");
  process.exit(0);
});
setTimeout(() => Bun.unsafe.snapshot({ timers: "cancel" }), 50);
