const dgram = require("dgram");
const socket = dgram.createSocket("udp4");

const [port, address, data, base64] = process.argv.slice(2);
const message = data ? (base64 ? Buffer.from(data, "base64") : data) : "";

socket.send(message, port, address, error => {
  if (error) {
    console.error(error);
    process.exit(1);
  }
  socket.close();
});
