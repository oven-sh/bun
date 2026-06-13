// Peer side of the "busy-loop on half-closed UDS" regression. Connects to the
// survivor's UDS and pauses (never reads) so the survivor's writes pile up into
// backpressure. Prints CONNECTED, then sits idle until the test SIGKILLs it.
const net = require("node:net");

const sockPath = process.env.UDS_PATH;

const client = net.connect(sockPath, () => {
  console.log("CONNECTED");
});
// Never consume — let the survivor's writes create backpressure.
client.pause();
client.on("error", () => {});
