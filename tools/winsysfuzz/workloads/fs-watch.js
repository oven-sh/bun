// scenario: fs.watch — the ReadDirectoryChangesW / NtNotifyChangeDirectoryFile path
const fs = require("fs");
fs.mkdirSync("watched", { recursive: true });
const got = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("watch timeout")), 8000);
  const w = fs.watch("watched", (event, filename) => {
    clearTimeout(t);
    w.close();
    resolve(`${event}:${filename}`);
  });
  // give the watcher a moment to arm, then perturb
  setTimeout(() => fs.writeFileSync("watched/f.txt", "change"), 150);
});
const ev = await got;
fs.rmSync("watched", { recursive: true });
console.log(`fs-watch ok ${ev}`);
