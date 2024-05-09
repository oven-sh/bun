process.setUncaughtExceptionCaptureCallback(err => {
  throw new Error("bar");
});

throw new Error("foo");
