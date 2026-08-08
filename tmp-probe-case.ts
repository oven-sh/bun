import { readFileSync } from "fs";
import { join } from "path";
import tls from "tls";

const tlsFixtures = join(import.meta.dir, "test", "js", "node", "tls", "fixtures");
const serverKey = readFileSync(join(tlsFixtures, "agent10-key.pem"), "utf8");
const serverCert = readFileSync(join(tlsFixtures, "agent10-cert.pem"), "utf8");
const clientCa = readFileSync(join(tlsFixtures, "ca5-cert.pem"), "utf8");

const server = Bun.serve({
  port: 0,
  tls: [
    { key: serverKey, cert: serverCert },
    {
      serverName: "Admin.Example.com", // mixed case, as a user might type it
      key: serverKey,
      cert: serverCert,
      ca: clientCa,
      requestCert: true,
      rejectUnauthorized: true,
    },
  ],
  fetch: req => new Response(`SERVED ${req.headers.get("host")}`),
});

function request(servername: string | undefined, hostHeader: string): Promise<string> {
  return new Promise(resolve => {
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, servername, rejectUnauthorized: false });
    let received = "";
    socket.on("secureConnect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", c => (received += c.toString()));
    socket.on("error", () => {});
    socket.on("close", () => resolve(received.split("\r\n")[0] || "connection closed without a response"));
  });
}

console.log("no SNI, Host lowercase      :", await request(undefined, "admin.example.com"));
console.log("no SNI, Host exact mixedcase:", await request(undefined, "Admin.Example.com"));
console.log("no SNI, Host UPPER          :", await request(undefined, "ADMIN.EXAMPLE.COM"));
console.log("SNI lowercase (handshake)   :", await request("admin.example.com", "admin.example.com"));
console.log("SNI exact mixedcase         :", await request("Admin.Example.com", "Admin.Example.com"));
server.stop(true);
