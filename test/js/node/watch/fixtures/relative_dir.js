import fs from "fs";
try {
  let sawChange = false;
  const watcher = fs.watch("./myrelativedir/", { signal: AbortSignal.timeout(2000) });

  watcher.on("change", function (event, filename) {
    if (filename !== "relative.txt") {
      console.error("fail", filename, event);
      clearInterval(interval);
      watcher.close();
      process.exit(1);
    } else {
      sawChange = true;
      clearInterval(interval);
      watcher.close();
    }
  });
  watcher.on("error", err => {
    clearInterval(interval);
    console.error(err.message);
    process.exit(1);
  });
  // The abort timeout only emits 'close', so a watcher that never delivered a
  // change event has to be failed here (and the interval cleared so we exit).
  watcher.on("close", () => {
    clearInterval(interval);
    if (!sawChange) {
      console.error("timed out without a change event");
      process.exit(1);
    }
  });

  const interval = setInterval(() => {
    fs.writeFileSync("./myrelativedir/relative.txt", "world");
  }, 10);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
