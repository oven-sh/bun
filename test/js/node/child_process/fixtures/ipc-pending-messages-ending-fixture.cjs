// Prints what becomes of kept IPC messages where a process ends, or is at the stack limit. Run it with node to compare.
// CommonJS, and one process per row: the last row is about a process that has not used process.nextTick() yet.
const { fork, spawn } = require("node:child_process");
const { once } = require("node:events");

const rows = [
  "child, a listener and then an exception that nobody handles",
  "child, a listener and then an exception at the top level of an ES module",
  "child, a listener that throws and two more on() in one turn",
  "parent, a listener and then an exception that nobody handles",
  "parent, a listener added in 'exit'",
  "child, on() down to the stack limit before the first tick",
];
const [role, row] = process.argv.slice(2);
const late = message => console.log("late", message);
const whenAllHaveArrived = (target, listener) =>
  target.on("internalMessage", ({ cmd }) => cmd === "NODE_that was all" && listener());
const sendAll = target => {
  target.send("first");
  target.send({ cmd: "NODE_that was all" });
};

if (role === undefined) {
  const run = async row => {
    const parent = spawn(process.execPath, [__filename, "parent", row], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    parent.stdout.on("data", chunk => (output += chunk));
    const [code] = await once(parent, "close");
    return `${row}: ${JSON.stringify(output.split("\n").filter(Boolean))}, exit code ${code}`;
  };
  Promise.all(rows.map(run)).then(lines => console.log(lines.join("\n")));
} else if (role === "parent") {
  const options = row.includes("'exit'") ? { silent: true } : { stdio: ["ignore", "inherit", "ignore", "ipc"] };
  const child = fork(
    row.includes("ES module") ? __dirname + "/ipc-pending-messages-ending-fixture.mjs" : __filename,
    ["child", row],
    options,
  );
  if (row.startsWith("child")) {
    child.on("internalMessage", ({ cmd }) => cmd === "NODE_ready" && sendAll(child));
    child.on("exit", code => console.log("child exit code", code));
  } else if (row.includes("'exit'")) {
    child.on("disconnect", () => console.log("disconnect", child.channel));
    child.on("exit", () => {
      console.log("exit", child.channel);
      child.on("message", late);
    });
    child.on("close", () => console.log("close"));
  } else {
    process.on("exit", code => {
      console.log("exit listener", code);
      child.kill("SIGKILL");
    });
    whenAllHaveArrived(child, () => {
      child.on("message", late);
      throw new Error("nobody handles this");
    });
  }
} else if (row.includes("'exit'")) {
  process.send("first", () => process.exit());
} else if (row.startsWith("parent")) {
  process.on("message", () => {});
  sendAll(process);
} else {
  process.on("disconnect", () => process.exit());
  process.on("exit", code => console.log("exit listener", code));
  whenAllHaveArrived(process, () => {
    if (row.includes("stack limit")) {
      const recurse = () => {
        try {
          recurse();
        } catch (error) {
          try {
            process.once("another event", recurse);
          } catch {}
          throw error;
        }
      };
      try {
        recurse();
      } catch (error) {
        console.log(error.name, typeof process.nextTick);
      }
      process.nextTick(console.log, "tick");
      setImmediate(() => process.disconnect());
    } else if (row.includes("that throws")) {
      process.on("message", message => {
        late(message);
        throw new Error("nobody handles this");
      });
      process.on("another event", () => {});
      process.on("one more event", () => {});
    } else {
      process.on("message", late);
      throw new Error("nobody handles this");
    }
  });
  process.send({ cmd: "NODE_ready" });
}
