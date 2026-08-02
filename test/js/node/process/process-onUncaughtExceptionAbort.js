process.on("exit", () => console.log("exit-listener"));

process.on("uncaughtException", err => {
  console.log("handler");
  throw new Error("bar");
});

throw new Error("foo");
