for (let i = 0; i < 1024; i++) {
  eval(`console.trace();`);
}
Bun.gc(true);
const baseline = process.memoryUsage.rss();

for (let j = 0; j < 1024; j++) {
  for (let i = 0; i < 1024; i++) {
    eval(`console.trace();`);
  }
}
Bun.gc(true);
const delta = ((process.memoryUsage.rss() - baseline) / 1024 / 1024) | 0;
console.error(delta, "MB", "delta");
// on macOS in a debug build, this was 124 MB after fixing the leak.
// on macOS in a leaking release build, this was 239 MB.
if (delta > 200) {
  throw new Error("Memory leak detected");
}
