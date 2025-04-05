const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

if (process.argv[2] === "child") {
  // Send initial message to parent
  process.send({ status: "Child process started" });
} else {
  // Spawn child process with IPC enabled
  const child = spawn(process.execPath, [process.argv[1], "child"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  // Listen for messages from child
  child.on("message", message => {
    console.log("Parent received:", JSON.stringify(message));
  });

  // Handle child process exit
  child.on("exit", code => {
    console.log(`Child process exited with code ${code}`);
    try {
      console.log("send returned", child.send({ msg: "uh oh" }));
    } catch (ex) {
      console.log("[1]caught", ex.code);
    }
    try {
      child.send({ msg: "uh oh!" }, a => {
        console.log("cb", a.code);
      });
    } catch (ex) {
      console.log("[2]caught", ex.code);
    }
  });
  process.on("uncaughtException", err => {
    console.log("uncaughtException", err.code);
  });

  // Send initial message to child

  // support:
  // net.Socket, net.Server, net.Native, dgram.Socket, dgram.Native
  // sends message {cmd: NODE_HANDLE, type: }

  const server = net.createServer();

  child.send({ greeting: "Hello child process!" }, server);

  // Listen for messages from parent
  process.on("message", message => {
    console.log("Child received:", JSON.stringify(message));

    // Send a message back to parent
    process.send({ message: "Hello from child!" });
    process.channel.unref();
  });
}
