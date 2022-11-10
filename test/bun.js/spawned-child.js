if (process.argv[2] === "STDIN") {
  let result = "";
  process.stdin.on("data", (data) => {
    result += data;
  });
  process.stdin.on("close", () => {
    console.log(result);
  });
} else {
  setTimeout(() => console.log("hello"), 150);
}
