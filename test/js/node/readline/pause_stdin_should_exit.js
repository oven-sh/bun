process.stdin.on("pause", () => {
  console.log("pause");
});
process.stdin.on("resume", () => {
  console.log("resume");
});

process.stdin.on("data", data => {
  console.log("got data", data);
});
process.stdin.pause();
