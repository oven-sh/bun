const timer = setTimeout(() => {}, 999_999_999);
if (timer.unref() !== timer) throw new Error("Expected timer.unref() === timer");

var ranCount = 0;
const going2Refresh = setTimeout(() => {
  if (ranCount < 1) going2Refresh.refresh();
  ranCount++;

  if (ranCount === 2) {
    console.log("SUCCESS");
  }
}, 1);
