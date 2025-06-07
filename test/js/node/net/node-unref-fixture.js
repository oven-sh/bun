const { connect } = require("tls");

const socket = connect(
  {
    host: "www.example.com",
    port: 443,
    rejectUnauthorized: false,
  },
  () => {
    socket.on("data", () => {
      console.error("Received data. FAIL");
      process.exit(1);
    });
    socket.write("GET / HTTP/1.1\r\nHost: www.example.com\r\n\r\n\r\n");
  },
);
socket.unref();
socket.ref();
socket.ref();
socket.ref();
socket.unref();
