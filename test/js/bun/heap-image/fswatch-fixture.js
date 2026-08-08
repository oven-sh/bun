// The builder owns an FSEvents loop (a watcher exists at snapshot time); a restored process must get a working, fresh one.
const fs = require("fs");
const path = require("path");
const dir = process.env.WATCH_DIR;
fs.watch(dir, () => {}); // builder-side watcher: puts a loop (and its CF thread) into the image
process.on("restore", () => {
  const dir2 = process.env.WATCH_DIR2;
  const seen = [];
  const w = fs.watch(dir2, (event, filename) => { seen.push(`${event}:${filename}`); });
  setTimeout(() => fs.writeFileSync(path.join(dir2, "touched.txt"), "x"), 50);
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (seen.length || Date.now() - t0 > 8000) {
      clearInterval(iv); w.close();
      console.log("[js] " + JSON.stringify(seen));
      process.exit(0);
    }
  }, 20);
});
setTimeout(() => Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { cancelTimers: true }), 100);
