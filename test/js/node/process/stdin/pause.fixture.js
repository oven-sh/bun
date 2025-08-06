console.log("%READY%");

const r = () => {
  let chunk;
  if (ceaseReading) return;
  while ((chunk = process.stdin.read()) !== null) {
    console.log("got readable", JSON.stringify(chunk.toString()));
  }
};

let ceaseReading = false;
process.stdin.on("data", data => {
  const dataString = data.toString().trim();
  console.log("got stdin", JSON.stringify(dataString));
  if (dataString === "pause") {
    process.stdin.pause();
  } else if (dataString === "attachReadable") {
    process.stdin.on("readable", r);
  } else if (dataString === "detachReadable") {
    process.stdin.off("readable", r);
    return;
  } else if (dataString === "ceaseReading") {
    ceaseReading = true;
  } else if (dataString === "exit") {
    process.exit(123);
  }
  console.log("%READY%");
});

process.on("beforeExit", code => {
  console.log("beforeExit with code " + code);
});
process.on("exit", code => {
  console.log("exit with code " + code);
});
