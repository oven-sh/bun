const hostname = process.argv[2];
const port = process.argv[3];

const host = port ? `http://${hostname}:${port}` : hostname;

const ws = new WebSocket(host);

ws.onmessage = (message) => {
  if (message.data == "hello websocket") {
    ws.send("hello");
  } else if (message.data == "close") {
    ws.close();
  }
};
