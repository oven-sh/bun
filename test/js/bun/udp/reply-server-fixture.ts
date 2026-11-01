// A reply server in the shape of the docs: it answers every datagram and has
// no error handler. argv: the API ("dgram" or "udpSocket") and the address to
// bind. It prints its port, then holds its event loop until the parent writes
// a byte to stdin, so the parent decides what the first readable event holds.
// It prints a line for each datagram it answered.
import { createSocket } from "node:dgram";
import { readSync, writeSync } from "node:fs";

const [api, address] = process.argv.slice(2);

function holdUntilParentWrites(port: number) {
  writeSync(1, port + "\n");
  readSync(0, Buffer.alloc(1));
}

if (api === "dgram") {
  const server = createSocket(address.includes(":") ? "udp6" : "udp4");
  server.on("message", (msg, rinfo) => {
    if (msg.toString() === "close") return server.close();
    server.send(msg, rinfo.port, rinfo.address);
    writeSync(1, "answered\n");
  });
  server.bind(0, address, () => holdUntilParentWrites(server.address().port));
} else {
  const server = await Bun.udpSocket({
    hostname: address,
    socket: {
      data(socket, data, port, from) {
        if (data.toString() === "close") return socket.close();
        socket.send(data, port, from);
        writeSync(1, "answered\n");
      },
    },
  });
  holdUntilParentWrites(server.port);
}
