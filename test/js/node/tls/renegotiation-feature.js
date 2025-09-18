const server = require("https").createServer(
  {
    cert: process.env.SERVER_CERT,
    key: process.env.SERVER_KEY,
    rejectUnauthorized: false,
    hostname: "localhost",
    minVersion: "TLSv1.2",
    // force maxVersion to be TLSv1.2 so that renegotiation is allowed
    maxVersion: "TLSv1.2",
  },
  (req, res) => {
    const client = res.socket;
    client.renegotiate({ requestCert: true, rejectUnauthorized: false }, err => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error");
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      }
    });
  },
);

server.listen(0, () => {
  const { port } = server.address();
  const url = `https://localhost:${port}`;
  console.log(url);
});
