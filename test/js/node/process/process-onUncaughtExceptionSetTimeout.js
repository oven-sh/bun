let monitorCalled = false;

setTimeout(() => {
  // uncaughtExceptionMonitor should be called
  if (!monitorCalled) {
    process.exit(1);
  }
  // timeouts should be processed
  process.exit(42);
}, 100);

process.on("uncaughtExceptionMonitor", err => {
  // Ensure this is not zero or another invalid argument
  Object.getOwnPropertyNames(err);
  String(err);

  monitorCalled = true;
  if (!err) {
    process.exit(1);
  }
});

process.on("uncaughtException", err => {
  // Ensure this is not zero or another invalid argument
  Object.getOwnPropertyNames(err);
  String(err);

  // there should be an error
  if (!err) {
    process.exit(1);
  }
});

setTimeout(() => {
  throw new Error("Error");
}, 1);
