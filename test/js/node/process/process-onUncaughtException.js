let monitorCalled = false;

setTimeout(() => {
  // uncaughtExceptionMonitor should be called
  if (!monitorCalled) {
    process.exit(1);
  }
  // timeouts should be processed
  process.exit(42);
}, 1);

process.on("uncaughtExceptionMonitor", err => {
  monitorCalled = true;
  if (!err) {
    process.exit(1);
  }
});

process.on("uncaughtException", err => {
  // there should be an error
  if (!err) {
    process.exit(1);
  }
});

throw new Error("error");

// this shouldn't be hit even if the exception is caught
process.exit(1);
