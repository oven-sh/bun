let monitorCalled = false;

setTimeout(async () => {
  console.log("setTimeout");
  // uncaughtExceptionMonitor should be called
  if (!monitorCalled) {
    process.exit(1);
  }
  // timeouts should be processed
  process.exit(42);
}, 1);

process.on("uncaughtExceptionMonitor", err => {
  console.log("uncaughtExceptionMonitor");
  monitorCalled = true;
  if (!err) {
    process.exit(1);
  }
});

process.setUncaughtExceptionCaptureCallback(err => {
  console.log("setUncaughtExceptionCaptureCallback");
  // there should be an error
  if (!err) {
    process.exit(1);
  }
});

throw new Error("error");

// this shouldn't be hit even if the exception is caught
process.exit(1);
