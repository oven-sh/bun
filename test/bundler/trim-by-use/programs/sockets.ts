// Bun.listen and Bun.connect, then node:net, on 127.0.0.1
import net from "node:net";
const done = Promise.withResolvers<string>();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket: any, data: any) {
      socket.write("echo:" + data.toString());
      socket.end();
    },
    open(socket: any) {
      socket.data = { opened: true };
    },
  },
});
let got = "";
await Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  socket: {
    open(socket: any) {
      socket.write("hi");
    },
    data(_socket: any, data: any) {
      got += data.toString();
    },
    close() {
      done.resolve(got);
    },
  },
});
console.log(await done.promise, listener.hostname, typeof listener.port);
listener.stop(true);
const second = Promise.withResolvers<string>();
const server = net.createServer((socket: any) => {
  socket.on("data", (data: any) => socket.end("node:" + data));
});
server.listen(0, "127.0.0.1", () => {
  const client: any = net.connect((server.address() as { port: number }).port, "127.0.0.1", () => client.write("hey"));
  let text = "";
  client.on("data", (data: any) => (text += data));
  client.on("close", () => second.resolve(`${text} ${client.remoteFamily ?? "closed"}`));
});
console.log(await second.promise);
server.close();
