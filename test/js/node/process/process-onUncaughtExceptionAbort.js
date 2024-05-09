process.on("uncaughtException", err => {
  throw new Error("bar");
});

throw new Error("foo");
