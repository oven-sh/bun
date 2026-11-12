// Takes the sockets its peer sends. It reads nothing of the channel, and so acks nothing, until a
// byte arrives on stdin. The peer is its parent, or the sender it forks when it has none.
const { readSync } = require("node:fs");
const { join } = require("node:path");

const peer = process.send
  ? process
  : require("node:child_process").fork(join(__dirname, "child-process-sent-socket-sender.js"), process.argv.slice(2));
// The end of stdin is the end of whoever tells it to ack.
function untilToldToAck() {
  if (readSync(0, Buffer.alloc(1)) === 0) process.exit(1);
}

peer.on("message", (message, socket) => {
  // "echo": keeps the socket, and goes on reading the channel until the next message.
  if (message === "echo") socket.pipe(socket);
  else if (socket) socket.destroy();
  peer.send("done");
  if (message !== "echo") untilToldToAck();
});
if (peer !== process) peer.on("exit", code => process.exit(code));
untilToldToAck();
