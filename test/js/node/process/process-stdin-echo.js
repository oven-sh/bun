process.stdin.setEncoding("utf8");
process.stdin.on("data", data => {
  process.stdout.write(data);
});
process.stdin.once(process.argv[2] === "close-event" ? "close" : "end", () => {
  process.stdout.write(process.argv[2] === "close-event" ? "ENDED-CLOSE" : "ENDED");
});
if (process.argv[2] === "resume") {
  process.stdout.write("RESUMED");
  process.stdin.resume();
}
