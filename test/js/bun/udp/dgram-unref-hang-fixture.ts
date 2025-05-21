import dgram from "node:dgram";
const socket = dgram.createSocket({ type: "udp4" });
socket.unref();
socket.send("test", 1337, "127.0.0.1", (error, bytes) => {
  console.log(error, bytes);
});
