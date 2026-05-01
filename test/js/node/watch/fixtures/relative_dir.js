import fs from "fs";
try {
  const watcher = fs.watch("./myrelativedir/", { signal: AbortSignal.timeout(2000) });

  watcher.on("change", function (event, filename) {
    if (filename !== "relative.txt") {
      console.error("fail", filename, event);
      clearInterval(interval);
      watcher.close();
      process.exit(1);
    } else {
      clearInterval(interval);
      watcher.close();
    }
  });
  watcher.on("error", err => {
    clearInterval(interval);
    console.error(err.message);
    process.exit(1);
  });

  const interval = setInterval(() => {
    fs.writeFileSync("./myrelativedir/relative.txt", "world");
  }, 10);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
