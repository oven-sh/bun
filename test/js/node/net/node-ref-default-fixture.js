const { connect } = require("tls");

const socket = connect(
  {
    host: "www.example.com",
    port: 443,
    rejectUnauthorized: false,
  },
  () => {
    socket.on("data", () => {
      process.exit(1);
    });
    socket.write("GET / HTTP/1.1\r\nHost: www.example.com\r\n\r\n\r\n");
  },
);
