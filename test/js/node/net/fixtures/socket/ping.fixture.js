const net = require("node:net");

const server = new net.Server();
const client = new net.Socket();

const serverEmit = server.emit,
  clientEmit = client.emit;

const verboseEmit = (name, originalEmit) => {
  const log = (...args) => console.log(`[${name}]`, ...args);
  return function verboseEmit(...args) {
    const [eventName, ...rest] = args;
    switch (eventName) {
      case "data":
        log("data:", ...rest.map(d => d.toString()));
        break;
      default:
        if (args[1] && args[1] instanceof Error) {
          log(eventName, args[1].message);
        } else {
          log(eventName);
        }
    }
    return originalEmit.apply(this, args);
  };
};

Object.defineProperty(server, "emit", { value: verboseEmit("server", serverEmit) });
Object.defineProperty(client, "emit", { value: verboseEmit("client", clientEmit) });

server.on("connection", socket => {
  socket.on("data", data => {
    console.log("[server] socket data:", data.toString());
    socket.write(data);
    process.nextTick(() => socket.end());
  });
  socket.on("close", () => server.close());
});

client.on("data", () => client.end());

server.listen(0, () => {
  client.connect(server.address(), () => {
    client.write("ping");
  });
});
