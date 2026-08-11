// An unhandled rejection after restore has to end the process the same way it does in a normally-booted one: exit code 1.
function fail() { Promise.reject(new Error("unhandled after restore")); }
if (process.env.PLAIN) fail();
else {
  process.on("restore", fail);
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
