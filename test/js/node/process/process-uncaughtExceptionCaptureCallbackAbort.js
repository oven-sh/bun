process.on("exit", () => console.log("exit-listener"));

process.setUncaughtExceptionCaptureCallback(err => {
  console.log("handler");
  throw new Error("bar");
});

throw new Error("foo");
