// Child that reads from stdin
process.stdin.setRawMode(true);
let count = 0;
console.log("CHILD: reading");
console.log("%ready%");
process.stdin.on("data", chunk => {
  const chunkStr = chunk.toString("utf-8");
  console.log("CHILD: received " + JSON.stringify(chunkStr));

  if (chunkStr.includes("\x03") || chunkStr.includes("\r") || chunkStr.includes("\n")) {
    console.log("CHILD: exiting");
    process.exit(0);
  }
  console.log("%ready%");
});
