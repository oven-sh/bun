process.stdin.setEncoding("utf8");
process.stdin.on("data", data => {
  process.stdout.write(data);
});
process.stdin.once("end", () => {
  process.stdout.write("ENDED");
});
if (process.argv[2] == "resume") {
  process.stdout.write("RESUMED");
  process.stdin.resume();
}
