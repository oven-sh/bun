// `tls.connect({ socket: <generic Duplex>, requestOCSP: true })`. Runs in its own
// process because the "requestOCSP is ignored" warning fires once per process.
// Prints the two endpoints' event logs as JSON on stdout; the warning itself goes
// to stderr, which is what the caller asserts on.
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";

const cert = process.env.OCSP_CERT!;
const key = process.env.OCSP_KEY!;

const serverLog: string[] = [];
const clientLog: string[] = [];

const server = tls.createServer({ cert, key }, socket => {
  serverLog.push("secureConnection");
  socket.end();
});
server.on("OCSPRequest", (_certificate, _issuer, callback) => {
  serverLog.push("OCSPRequest");
  callback(null, Buffer.from("never requested"));
});

server.listen(0, () => {
  const { port } = server.address() as net.AddressInfo;
  const raw = net.connect(port, "127.0.0.1", () => {
    // A plain net.Socket is adopted into a native TLS socket; wrapping it in a
    // bare Duplex forces the SSLWrapper path instead.
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        raw.write(chunk, callback);
      },
      final(callback) {
        raw.end();
        callback();
      },
    });
    raw.on("data", chunk => duplex.push(chunk));
    raw.on("end", () => duplex.push(null));

    const client = tls.connect({ socket: duplex, requestOCSP: true, rejectUnauthorized: false });
    client.on("OCSPResponse", () => clientLog.push("OCSPResponse"));
    client.on("secureConnect", () => {
      clientLog.push("secureConnect");
      client.end();
    });
    client.on("error", () => {});
    client.on("close", () => {
      raw.destroy();
      server.close(() => {
        process.stdout.write(JSON.stringify({ serverLog, clientLog }));
        process.exit(0);
      });
    });
  });
});
