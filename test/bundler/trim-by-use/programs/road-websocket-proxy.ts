const socket = new WebSocket("ws://127.0.0.1:9/", { proxy: "http://127.0.0.1:9" } as any);
socket.onerror = () => {
  console.log("error event");
};
socket.onclose = event => {
  console.log("closed", event.code);
};
