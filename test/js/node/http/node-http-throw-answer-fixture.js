// A 'request' listener throws before it writes anything, on a connection that the client keeps.
//
// usage: <tcp|tls>
// The only line of stdout is the result as JSON: what the client received until the connection
// closed. Node.js answers nothing and keeps the connection, so this file does not end there.
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const isTLS = process.argv[2] === "tls";
const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const options = isTLS
  ? {
      key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
      cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
    }
  : {};

const events = [];
process.on("uncaughtException", err => events.push(`uncaught: ${err.message}`));

const server = (isTLS ? https : http).createServer(options, req => {
  events.push(`request ${req.url}`);
  throw new Error("request threw");
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  const client = isTLS
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  client.setEncoding("latin1");
  client.on("error", () => {});
  let answer = "";
  client.on("data", chunk => (answer += chunk));
  await once(client, isTLS ? "secureConnect" : "connect");
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  await once(client, "close");
  console.log(JSON.stringify({ events, answer: answer.replace(/Date: [^\r]+\r\n/, "") }));
  process.exit(0);
});
