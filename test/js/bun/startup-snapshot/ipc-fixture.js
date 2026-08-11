// Whether this launch has an IPC channel to a parent is decided by the parent that spawned it — the builder had none.
const seenWhileBuilding = typeof process.send; // the usual module-scope `if (process.send)` check: this reifies the property in the builder
process.on("restore", () => {
  if (typeof process.send !== "function") { console.log("[js] no process.send after restore"); process.exit(3); }
  process.send({ channelVarScrubbed: !("NODE_CHANNEL_FD" in process.env), seenWhileBuilding });
  process.on("message", () => process.exit(0)); // the parent's ack ends the process
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
