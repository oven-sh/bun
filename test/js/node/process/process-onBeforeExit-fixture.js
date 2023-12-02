process.on("beforeExit", () => {
  console.log("beforeExit");
});

process.on("exit", () => {
  console.log("exit");
});
