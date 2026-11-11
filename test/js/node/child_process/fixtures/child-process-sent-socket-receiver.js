// Takes the sockets its peer sends. It reads nothing of the channel, and so acks nothing, until a
// byte arrives on stdin. The peer is its parent, or the sender it forks when it has none.
const { readSync } = require("node:fs");
const { join } = require("node:path");

const peer = process.send
  ? process
  : require("node:child_process").fork(join(__dirname, "child-process-sent-socket-sender.js"), process.argv.slice(2));
const untilToldToAck = () => readSync(0, Buffer.alloc(1));

peer.on("message", (message, socket) => {
  if (socket) socket.destroy();
  peer.send("done");
  untilToldToAck();
});
if (peer !== process) peer.on("exit", code => process.exit(code));
untilToldToAck();
