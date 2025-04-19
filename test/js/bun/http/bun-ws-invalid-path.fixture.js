import { Server } from "node:http";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = 0;

const server = new Server();

const wss = new WebSocketServer({
  server,
  path: "/ws",
});

server.listen(PORT, HOST, () => {
  const target = `http://${HOST}:${server.address()?.port}`;

  const ws = new WebSocket(`${target}/crash`);

  ws.onclose = () => {
    setTimeout(() => {
      process.exit(0);
    }, 100);
  };
});
