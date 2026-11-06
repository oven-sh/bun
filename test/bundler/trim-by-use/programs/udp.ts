// Bun.udpSocket and node:dgram on 127.0.0.1
import dgram from "node:dgram";
const { promise, resolve } = Promise.withResolvers<string>();
const receiver = await Bun.udpSocket({
  hostname: "127.0.0.1",
  socket: {
    data(_socket: any, data: any, _port: number, address: string) {
      resolve(`${data.toString()} from ${address}`);
    },
  },
});
const sender = await Bun.udpSocket({ hostname: "127.0.0.1" });
sender.send("ping", receiver.port, "127.0.0.1");
console.log(await promise, receiver.hostname, receiver.address.family);
sender.close();
receiver.close();
const second = Promise.withResolvers<string>();
const socket = dgram.createSocket("udp4");
socket.on("message", (message: any, info: any) => second.resolve(`${message} ${info.address} ${info.family}`));
socket.bind(0, "127.0.0.1", () => {
  const other = dgram.createSocket("udp4");
  other.send("pong", socket.address().port, "127.0.0.1", () => other.close());
});
console.log(await second.promise);
socket.close();
