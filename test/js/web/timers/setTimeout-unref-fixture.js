const timer = setTimeout(() => {
  process.exit(1);
}, 999_999_999);
if (timer.unref() !== timer) throw new Error("Expected timer.unref() === timer");

var ranCount = 0;
process.exitCode = 1;
const going2Refresh = setTimeout(() => {
  if (ranCount < 1) going2Refresh.refresh();
  ranCount++;

  if (ranCount === 2) {
    process.exitCode = 0;
    console.log("SUCCESS");
  }
}, 1);
