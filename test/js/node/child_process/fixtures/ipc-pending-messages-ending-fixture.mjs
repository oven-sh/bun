// The ES module row of ipc-pending-messages-ending-fixture.cjs. It must not use process.nextTick() before it listens.
process.on("disconnect", () => process.exit());
process.on("exit", code => console.log("exit listener", code));
const allHaveArrived = new Promise(resolve =>
  process.on("internalMessage", ({ cmd }) => cmd === "NODE_that was all" && resolve()),
);
process.send({ cmd: "NODE_ready" });
await allHaveArrived;
process.on("message", message => console.log("late", message));
throw new Error("nobody handles this");
