// Child that reads from stdin
process.stdin.setRawMode(true);
let count = 0;
process.stdin.on("data", () => {
  count++;
  console.log("CHILD:", count);

  if (count >= 3) {
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});
