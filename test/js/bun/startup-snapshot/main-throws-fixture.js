// main() throwing synchronously has to end the process the way a throw at module scope does: printed, exit code 1.
Bun.startupSnapshot.main(() => {
  throw new Error("main threw on purpose");
}); // an ordinary launch runs it right here and never reaches the next line; the snapshot run keeps it aside
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
