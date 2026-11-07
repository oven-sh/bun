// Prints what send() does with a message that cannot be cloned on a channel with
// serialization "advanced", first in the parent and then in the child.
// argv[2] is "fork" (child_process.fork) or "cluster" (cluster.fork).
const cluster = require("node:cluster");
const { fork } = require("node:child_process");

const mode = process.argv[2];
const isChild = mode === "cluster" ? cluster.isWorker : process.argv[3] === "child";

function describeSends(channel) {
  const lines = [];
  const messages = {
    "a Proxy": new Proxy({}, {}),
    "a nested function": { callback() {} },
    "a nested symbol": { key: Symbol("s") },
  };
  for (const [label, message] of Object.entries(messages)) {
    try {
      // node throws before it queues anything, so the callback never runs.
      const sent = channel.send(message, error => console.log("UNEXPECTED callback for", label, error));
      lines.push(`${label}: send() returned ${sent}`);
    } catch (error) {
      lines.push(
        `${label}: threw ${Object.getPrototypeOf(error) === Error.prototype ? "a plain Error" : error.constructor.name}` +
          ` name=${error.name} code=${error.code} could-not-be-cloned=${/could not be cloned\.$/.test(error.message)}`,
      );
    }
  }
  return lines;
}

if (isChild) {
  const channel = mode === "cluster" ? cluster.worker : process;
  channel.on("message", message => {
    if (message !== "go") return;
    // This send arrives: the sends that threw left the channel usable.
    channel.send({ lines: describeSends(channel) });
  });
} else {
  if (mode === "cluster") cluster.setupPrimary({ serialization: "advanced" });
  const child =
    mode === "cluster" ? cluster.fork() : fork(__filename, ["fork", "child"], { serialization: "advanced" });
  child.on("error", error => console.log("UNEXPECTED error event", error));
  child.on("message", message => {
    for (const line of message.lines) console.log("child:", line);
    child.disconnect();
  });
  child.on("exit", code => console.log("child exited with code", code));
  for (const line of describeSends(child)) console.log("parent:", line);
  // This send arrives: the sends that threw left the channel usable.
  child.send("go");
}
