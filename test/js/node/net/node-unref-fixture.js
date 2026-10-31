const { connect } = require("tls");

const socket = connect(
  {
    host: "127.0.0.1",
    port: process.env.PORT,
    rejectUnauthorized: false,
  },
  () => {
    socket.on("data", () => {
      console.error("Received data. FAIL");
      process.exit(1);
    });
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n\r\n");
  },
);
socket.unref();
socket.ref();
socket.ref();
socket.ref();
socket.unref();
