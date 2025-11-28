let count = 0;
process.stdin.on("data", data => {
  count += 1;
  console.log("got " + count, JSON.stringify(data.toString("utf-8")));
  if (count >= 2) {
    timeout.unref();
  }
});
process.stdin.unref(); // prevent stdin from keeping the process alive, but still allow reading from stdin
