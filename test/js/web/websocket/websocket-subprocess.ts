const host = process.argv[2];

const ws = new WebSocket(host);

ws.onmessage = message => {
  if (message.data === "hello websocket") {
    ws.send("hello");
  } else if (message.data === "timeout") {
    setTimeout(() => {
      ws.send("close");
    }, 300);
  }
};

ws.onclose = () => {
  console.log("Closed!");
};

ws.onerror = e => {
  console.error(e);
};

ws.onopen = () => {
  console.log("Connected!");
};
