const createInterval =
  process.argv[2] == "with-interval"
    ? true
    : process.argv[2] == "without-interval"
      ? false
      : (() => {
          throw new Error("bad argument");
        })();

let interval: Timer | undefined;
if (createInterval) {
  interval = setInterval(() => {}, 1000);
}

let i = 0;
setImmediate(function callback() {
  i++;
  console.log("callback");
  if (i < 5000) {
    setImmediate(callback);
  } else if (interval) {
    clearInterval(interval);
  }
});
