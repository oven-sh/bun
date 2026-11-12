// What req.socket asks of a connection that node:http has
import http from "node:http";
import net from "node:net";
const head = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n";
const server = http.createServer(request => {
  const { socket } = request;
  socket.pause().resume();
  socket.write(head);
  console.log(request.url, socket.bytesRead, socket.bytesWritten, socket.writableLength);
  if (request.url === "/end") socket.end("ok");
  else socket.write("ok", () => socket.destroy());
});
const ask = (path: string) =>
  new Promise<string>(resolve => {
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    let text = "";
    client.on("data", bytes => (text += bytes));
    client.on("close", () => resolve(text));
    client.write(`GET ${path} HTTP/1.1\r\nHost: a\r\n\r\n`);
  });
server.listen(0, "127.0.0.1", async () => {
  console.log(JSON.stringify([await ask("/end"), await ask("/destroy")]));
  server.close();
});
