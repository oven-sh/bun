// Child process that writes a raw internal-format message (JSON mode)
// followed by a normal message, to verify the parent handles it gracefully.
const fs = require("fs");
const fd = 3; // NODE_CHANNEL_FD

// In JSON IPC mode, byte 0x02 prefix marks a message as "internal" (cluster).
// Write an internal-format message directly to the IPC fd.
const internalMsg = Buffer.concat([
  Buffer.from([0x02]),
  Buffer.from(JSON.stringify({ cmd: "NODE_FAKE_INTERNAL" })),
  Buffer.from("\n"),
]);
fs.writeSync(fd, internalMsg);

// Now send a normal message through the standard API.
process.send("normal_after_internal");
